import * as THREE from 'three'
import type { PlacementType } from '../../types/product'
import { DEFAULT_WALL_DEPTH, PLANE_TTL_MS, assumedWall, rayOntoHeight, type SurfaceHeight, type SurfaceHit } from './objectPlacement'

const UP = new THREE.Vector3(0, 1, 0)
/** cos(~30°): a plane whose normal deviates more than this is not horizontal. */
const MIN_UP_DOT = 0.86
/** A plane is a wall when its normal is within ~20° of horizontal. */
const MAX_WALL_UP_DOT = 0.35
const MAX_DISTANCE: Record<PlacementType, number> = { floor: 10, tabletop: 4, wall: 6 }
/** Typical phone height above the surface (standing over a floor / above a table), in metres. */
const ASSUMED_DROP: Record<Exclude<PlacementType, 'wall'>, number> = { floor: 1.35, tabletop: 0.4 }

export type WebXRTrackingStatus = 'initializing' | 'normal' | 'lost'

/**
 * Native WebXR world tracking (ARCore through Chrome on Android).
 *
 * Unlike monocular in-browser SLAM, ARCore fuses the camera with the IMU and depth cues, so
 * distances are metric: a product placed at 100% stays true-size as you walk around it, and a
 * pinched size holds. The product is held by an ARCore anchor, which ARCore keeps correcting as
 * its map of the room improves (and restores after tracking is briefly lost).
 *
 * The browser composites the camera feed itself; Three.js only draws the virtual content, and
 * the app's React UI stays on top through the DOM-overlay feature.
 */
export class WebXRTracking {
  readonly scene = new THREE.Scene()
  /** Receives the XR viewer pose and projection after every render (see WebXRManager). */
  readonly camera = new THREE.PerspectiveCamera()
  readonly renderer: THREE.WebGLRenderer
  /** Called when the browser ends the session (system back button, app switch, …). */
  onEnd: (() => void) | null = null

  private session: XRSession | null = null
  private hitSource: XRHitTestSource | null = null
  private pointSource: XRHitTestSource | null = null
  private hadPose = false
  private readonly viewerPosition = new THREE.Vector3()
  /** Ray through the screen center, from this frame's viewer pose. */
  private readonly centerRay = new THREE.Ray()
  private wallDepth = DEFAULT_WALL_DEPTH

  private anchor: XRAnchor | null = null
  private anchorRequest = 0
  private pendingAnchor: THREE.Vector3 | null = null
  private readonly anchorPosition = new THREE.Vector3()
  private readonly drift = new THREE.Vector3()

  constructor() {
    // Own offscreen canvas: the XR layer is what is displayed, and the 8th Wall canvas keeps
    // its context untouched in case the app has to fall back to it.
    this.renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), alpha: true, antialias: true })
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local')
    // Clip only what is closer than 1 cm, so the product can be inspected up close (Three's
    // default 10 cm cuts into it). WebXRManager passes this to the session as depthNear.
    this.camera.near = 0.01
  }

  /** Requests the immersive session. Call while the user's tap still counts as a gesture. */
  async start(overlayRoot: HTMLElement, onFrame: (frame: XRFrame) => void) {
    const session = await navigator.xr!.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['anchors', 'dom-overlay'],
      domOverlay: { root: overlayRoot },
    })
    this.session = session
    session.addEventListener('end', this.handleEnd)
    await this.renderer.xr.setSession(session)
    const viewerSpace = await session.requestReferenceSpace('viewer')
    // Planes carry a real orientation but take ARCore a second or more to form; feature points
    // are reported within a few frames of tracking and give the surface height right away.
    this.hitSource = (await session.requestHitTestSource?.({ space: viewerSpace, entityTypes: ['plane'] })) ?? null
    this.pointSource =
      (await session.requestHitTestSource?.({ space: viewerSpace, entityTypes: ['point'] })?.catch(() => undefined)) ?? null
    this.renderer.setAnimationLoop((_time, frame) => frame && onFrame(frame))
  }

  private get referenceSpace() {
    return this.renderer.xr.getReferenceSpace()
  }

  /** Tracking quality for this frame, from the viewer pose. */
  trackingStatus(frame: XRFrame): WebXRTrackingStatus {
    const space = this.referenceSpace
    const pose = space && frame.getViewerPose(space)
    if (pose && !pose.emulatedPosition) {
      const { position: p, orientation: o } = pose.transform
      this.viewerPosition.set(p.x, p.y, p.z)
      this.centerRay.origin.copy(this.viewerPosition)
      this.centerRay.direction.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w))
      this.hadPose = true
      return 'normal'
    }
    return this.hadPose ? 'lost' : 'initializing'
  }

  /**
   * Surface under the screen center: a detected plane when ARCore has one there; otherwise
   * feature points — on walls directly, on floors/tables through the measured surface height,
   * so the reticle and dots sit exactly on the real surface from the first tracked frames.
   */
  centerHit(frame: XRFrame, placement: PlacementType, height: SurfaceHeight): SurfaceHit | null {
    const space = this.referenceSpace
    if (!space) return null
    const now = performance.now()
    const plane = this.planeHit(frame, space, placement, height, now)
    if (plane) {
      if (placement === 'wall') this.rememberWallDepth(plane.position)
      return plane
    }

    const point = this.pointSource && frame.getHitTestResults(this.pointSource)[0]?.getPose(space)?.transform.position
    const position = point ? new THREE.Vector3(point.x, point.y, point.z) : null
    if (placement === 'wall') {
      const normal = position && this.viewerPosition.clone().sub(position).setY(0)
      if (position && normal && normal.lengthSq() > 1e-6 && position.distanceTo(this.viewerPosition) <= MAX_DISTANCE.wall) {
        this.rememberWallDepth(position)
        const surfaceRotation = new THREE.Quaternion().setFromUnitVectors(UP, normal.normalize())
        return { position, surfaceRotation, type: 'XR_POINT', distance: position.distanceTo(this.viewerPosition), confirmed: true }
      }
      // Plain wall, nothing tracked on it yet: an assumed wall facing the viewer, so the marker
      // still shows; placed art is moved onto the real wall once ARCore finds it.
      return this.hadPose ? assumedWall(this.centerRay.clone(), this.centerRay.direction, this.wallDepth) : null
    }
    if (position && position.y < this.viewerPosition.y - 0.05) height.add(position.y, now)
    const measured = height.value(now)
    // Until ARCore reports points (plain floors can take a moment), show the surface at the
    // typical height below the phone, so the reticle and dots appear right away. Distances are
    // metric, so this is close; it snaps onto the measured height as soon as points arrive.
    const surfaceY = measured ?? (this.hadPose ? this.viewerPosition.y - ASSUMED_DROP[placement] : null)
    const onSurface = surfaceY !== null ? rayOntoHeight(this.centerRay, surfaceY, placement) : null
    if (!onSurface) return null
    return {
      position: onSurface,
      surfaceRotation: new THREE.Quaternion(),
      type: 'XR_POINT',
      distance: onSurface.distanceTo(this.viewerPosition),
      confirmed: measured !== null,
    }
  }

  /** The assumed wall uses the distance of the last real wall seen (walls do not move). */
  private rememberWallDepth(point: THREE.Vector3) {
    const forward = this.centerRay.direction.clone().setY(0)
    if (forward.lengthSq() < 0.05) return
    const depth = point.clone().sub(this.viewerPosition).dot(forward.normalize())
    if (depth > 0.4 && depth < MAX_DISTANCE.wall) this.wallDepth = depth
  }

  /** Nearest detected plane under the screen center that suits the placement type. */
  private planeHit(frame: XRFrame, space: XRReferenceSpace, placement: PlacementType, height: SurfaceHeight, now: number): SurfaceHit | null {
    if (!this.hitSource) return null
    for (const result of frame.getHitTestResults(this.hitSource)) {
      const pose = result.getPose(space)
      if (!pose) continue
      const { position: p, orientation: o } = pose.transform
      const position = new THREE.Vector3(p.x, p.y, p.z)
      const distance = position.distanceTo(this.viewerPosition)
      if (distance > MAX_DISTANCE[placement]) continue
      // The hit pose's local +Y is the plane normal.
      const rotation = new THREE.Quaternion(o.x, o.y, o.z, o.w)
      const normal = UP.clone().applyQuaternion(rotation)
      if (placement === 'wall') {
        if (Math.abs(normal.y) > MAX_WALL_UP_DOT) continue
        // Level the normal and make it face the viewer, so art hangs upright and outward.
        normal.setY(0).normalize()
        const toViewer = this.viewerPosition.clone().sub(position).setY(0)
        if (normal.dot(toViewer) < 0) normal.negate()
        rotation.setFromUnitVectors(UP, normal)
      } else if (normal.y < MIN_UP_DOT) {
        continue
      } else {
        // Remember the plane's height so the surface extends beyond the plane's detected edges.
        height.add(position.y, now, PLANE_TTL_MS)
      }
      return { position, surfaceRotation: rotation, type: 'XR_PLANE', distance, confirmed: true }
    }
    return null
  }

  /** Anchors the product at `position`; replaces any previous anchor. */
  setAnchor(position: THREE.Vector3) {
    this.clearAnchor()
    this.pendingAnchor = position.clone()
  }

  clearAnchor() {
    this.anchorRequest++
    this.pendingAnchor = null
    this.anchor?.delete()
    this.anchor = null
  }

  /**
   * How far ARCore moved the anchor since the last frame (a map correction), or null. Apply it
   * to the product so it stays on the same real spot. Anchors can only be created inside an XR
   * frame, so a pending anchor is created here.
   */
  anchorDrift(frame: XRFrame): THREE.Vector3 | null {
    const space = this.referenceSpace
    if (!space) return null
    if (this.pendingAnchor && frame.createAnchor) {
      const at = this.pendingAnchor
      const request = this.anchorRequest
      this.pendingAnchor = null
      frame
        .createAnchor(new XRRigidTransform({ x: at.x, y: at.y, z: at.z }), space)
        .then((anchor) => {
          if (request !== this.anchorRequest) return anchor.delete()
          this.anchor = anchor
          this.anchorPosition.copy(at)
        })
        .catch(() => undefined) // anchors are optional; tracking itself is already stable
    }
    if (!this.anchor || !frame.trackedAnchors?.has(this.anchor)) return null
    const pose = frame.getPose(this.anchor.anchorSpace, space)
    if (!pose) return null
    const p = pose.transform.position
    this.drift.set(p.x - this.anchorPosition.x, p.y - this.anchorPosition.y, p.z - this.anchorPosition.z)
    this.anchorPosition.set(p.x, p.y, p.z)
    return this.drift.lengthSq() > 1e-10 ? this.drift : null
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  private handleEnd = () => {
    this.session = null
    this.onEnd?.()
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.clearAnchor()
    this.hitSource?.cancel()
    this.hitSource = null
    this.pointSource?.cancel()
    this.pointSource = null
    const session = this.session
    this.session = null
    if (session) {
      session.removeEventListener('end', this.handleEnd)
      session.end().catch(() => undefined)
    }
    this.renderer.dispose()
  }
}
