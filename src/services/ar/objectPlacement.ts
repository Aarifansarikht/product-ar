import * as THREE from 'three'
import type { PlacementType } from '../../types/product'

export interface SurfaceHit {
  position: THREE.Vector3
  /** Orientation of the surface; its local +Y is the surface normal (horizontal for walls). */
  surfaceRotation: THREE.Quaternion
  /**
   * Engine hit type; GROUND_PLANE = instant ray-cast onto the tracking ground; WALL_PLANE = fitted
   * wall; XR_PLANE = a plane detected by native WebXR (ARCore) tracking.
   */
  type: XR8HitTestType | 'GROUND_PLANE' | 'WALL_PLANE' | 'XR_PLANE' | 'XR_POINT'
  distance: number
  /**
   * Backed by real tracked geometry (feature points or a detected plane). Unconfirmed hits use
   * the engine's assumed ground height and may sit above or below the real floor.
   */
  confirmed: boolean
}

const POINT_TTL_MS = 1500
/** Detected planes are reliable, so their height is remembered longer (acts as plane extension). */
export const PLANE_TTL_MS = 6000
const MIN_HEIGHT_SAMPLES = 3
const MAX_HEIGHT_SAMPLES = 120

/**
 * Measured height of the surface the user is aiming at, from real tracked hits (feature points
 * and planes) — the median of recent samples, so single noisy points do not move it. Feature
 * points arrive within a few frames of tracking, long before a full plane is detected, which is
 * what makes placement both instant and accurate: the reticle and dots are drawn exactly at the
 * real floor/table height, extending the surface under the whole screen.
 */
export class SurfaceHeight {
  private samples: { y: number; expires: number }[] = []

  add(y: number, now: number, ttl = POINT_TTL_MS) {
    this.samples.push({ y, expires: now + ttl })
    if (this.samples.length > MAX_HEIGHT_SAMPLES) this.samples.shift()
  }

  value(now: number): number | null {
    this.samples = this.samples.filter((s) => s.expires > now)
    if (this.samples.length < MIN_HEIGHT_SAMPLES) return null
    const ys = this.samples.map((s) => s.y).sort((a, b) => a - b)
    return ys[Math.floor(ys.length / 2)]
  }

  clear() {
    this.samples = []
  }
}

/** Ray-casts a view ray onto the horizontal plane at height `y` (null when not looking down at it). */
export function rayOntoHeight(ray: THREE.Ray, y: number, placement: PlacementType): THREE.Vector3 | null {
  // Only when looking down at the surface (at least ~6° below the horizon) and it is below the camera.
  if (ray.direction.y > -0.1 || y > ray.origin.y - 0.05) return null
  const t = (y - ray.origin.y) / ray.direction.y
  if (t <= 0 || t > MAX_GROUND_DISTANCE[placement]) return null
  return ray.origin.clone().addScaledVector(ray.direction, t)
}

/**
 * Wall hit-test type priority. Walls have no ground estimate: they rely on detected vertical
 * planes and on feature points (textured walls, frames, switches, edges).
 */
const WALL_TYPES: XR8HitTestType[] = ['DETECTED_SURFACE', 'FEATURE_POINT']

const MAX_DISTANCE: Record<PlacementType, number> = { floor: 10, tabletop: 4, wall: 6 }
/** Ground ray-casts beyond this are too oblique (near the horizon) to be useful. */
const MAX_GROUND_DISTANCE: Record<PlacementType, number> = { floor: 6, tabletop: 2, wall: 0 }
/** cos(~30°): a surface whose normal deviates more than this is not horizontal. */
const MIN_UP_DOT = 0.86
/** A detected plane is a wall when its normal is within ~20° of horizontal. */
const MAX_WALL_UP_DOT = 0.35

const UP = new THREE.Vector3(0, 1, 0)
const tmpNormal = new THREE.Vector3()
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(UP.clone(), 0)
const ndc = new THREE.Vector2()

/** Horizontal unit vector from `point` toward the camera — the facing direction for wall items. */
function horizontalToward(camera: THREE.Camera, point: THREE.Vector3) {
  const cam = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
  const dir = cam.sub(point).setY(0)
  return dir.lengthSq() < 1e-6 ? new THREE.Vector3(0, 0, 1) : dir.normalize()
}

/**
 * Instant placement surface: ray-cast onto the tracking ground plane (y = 0).
 *
 * In responsive mode the engine defines its ground as y = 0 (the camera starts CAMERA_HEIGHT
 * above it), so this is the same plane ESTIMATED_SURFACE reports — available on the very first
 * tracked frame, before the engine has gathered enough features to answer a hit test. This is
 * the approach used by 8th Wall's own "place on ground" samples.
 */
function groundPlaneHit(camera: THREE.Camera, screenX: number, screenY: number, placement: PlacementType): SurfaceHit | null {
  const maxDistance = MAX_GROUND_DISTANCE[placement]
  if (!maxDistance) return null
  ndc.set(screenX * 2 - 1, -(screenY * 2 - 1))
  raycaster.setFromCamera(ndc, camera)
  // Only when looking down at the surface (at least ~6° below the horizon).
  if (raycaster.ray.direction.y > -0.1) return null
  const point = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3())
  if (!point) return null
  const distance = point.distanceTo(raycaster.ray.origin)
  if (distance > maxDistance) return null
  return { position: point, surfaceRotation: new THREE.Quaternion(), type: 'GROUND_PLANE', distance, confirmed: false }
}

/**
 * Floor/table hit: a detected horizontal plane if there is one; otherwise the view ray onto the
 * measured surface height (from feature points); otherwise, so the reticle still appears on the
 * first frame, the engine's assumed ground — unconfirmed until real points arrive.
 */
function horizontalHit(
  XR8: XR8Api,
  camera: THREE.Camera,
  screenX: number,
  screenY: number,
  placement: PlacementType,
  height: SurfaceHeight,
): SurfaceHit | null {
  const now = performance.now()
  ndc.set(screenX * 2 - 1, -(screenY * 2 - 1))
  raycaster.setFromCamera(ndc, camera)
  const ray = raycaster.ray
  let detected: XR8HitTestResult | null = null
  for (const hit of XR8.XrController.hitTest(screenX, screenY, ['FEATURE_POINT', 'DETECTED_SURFACE'])) {
    if (hit.distance > MAX_DISTANCE[placement] || hit.position.y > ray.origin.y - 0.05) continue
    if (hit.type === 'FEATURE_POINT') {
      height.add(hit.position.y, now)
    } else if (hit.type === 'DETECTED_SURFACE') {
      const { x, y, z, w } = hit.rotation
      if (tmpNormal.copy(UP).applyQuaternion(new THREE.Quaternion(x, y, z, w)).y < MIN_UP_DOT) continue
      height.add(hit.position.y, now, PLANE_TTL_MS)
      if (!detected || hit.distance < detected.distance) detected = hit
    }
  }
  if (detected) {
    const { x, y, z, w } = detected.rotation
    return {
      position: new THREE.Vector3(detected.position.x, detected.position.y, detected.position.z),
      surfaceRotation: new THREE.Quaternion(x, y, z, w),
      type: 'DETECTED_SURFACE',
      distance: detected.distance,
      confirmed: true,
    }
  }
  const measured = height.value(now)
  if (measured !== null) {
    const point = rayOntoHeight(ray, measured, placement)
    if (!point) return null
    return { position: point, surfaceRotation: new THREE.Quaternion(), type: 'GROUND_PLANE', distance: point.distanceTo(ray.origin), confirmed: true }
  }
  return groundPlaneHit(camera, screenX, screenY, placement)
}

/**
 * Finds the best placement surface at normalized screen coordinates (0..1, origin top-left).
 * Floors and tables use `horizontalHit`; walls use detected vertical planes and feature points.
 */
export function hitTestSurface(
  XR8: XR8Api,
  camera: THREE.Camera,
  screenX: number,
  screenY: number,
  placement: PlacementType,
  height: SurfaceHeight,
): SurfaceHit | null {
  if (placement !== 'wall') return horizontalHit(XR8, camera, screenX, screenY, placement, height)
  const priority = WALL_TYPES
  const results = XR8.XrController.hitTest(screenX, screenY, priority)

  let best: XR8HitTestResult | null = null
  let bestRank = Infinity
  for (const hit of results) {
    if (hit.type === 'UNSPECIFIED' || hit.distance > MAX_DISTANCE[placement]) continue
    const rank = priority.indexOf(hit.type)
    if (rank < 0) continue
    if (hit.type === 'DETECTED_SURFACE') {
      const { x, y, z, w } = hit.rotation
      tmpNormal.copy(UP).applyQuaternion(new THREE.Quaternion(x, y, z, w))
      const horizontal = tmpNormal.y >= MIN_UP_DOT
      const vertical = Math.abs(tmpNormal.y) <= MAX_WALL_UP_DOT
      if (placement === 'wall' ? !vertical : !horizontal) continue
    }
    if (rank < bestRank || (rank === bestRank && best && hit.distance < best.distance)) {
      best = hit
      bestRank = rank
    }
  }
  if (!best) return null

  // Wall normal: the detected plane's normal, flipped toward the viewer; for feature points
  // (no orientation) assume the wall faces the camera.
  const position = new THREE.Vector3(best.position.x, best.position.y, best.position.z)
  let normal = horizontalToward(camera, position)
  if (best.type === 'DETECTED_SURFACE') {
    const { x, y, z, w } = best.rotation
    const planeNormal = UP.clone().applyQuaternion(new THREE.Quaternion(x, y, z, w)).setY(0).normalize()
    normal = planeNormal.dot(normal) < 0 ? planeNormal.negate() : planeNormal
  }
  const surfaceRotation = new THREE.Quaternion().setFromUnitVectors(UP, normal)
  return { position, surfaceRotation, type: best.type as XR8HitTestType, distance: best.distance, confirmed: true }
}

const SAMPLE_OFFSETS = [
  [0, 0],
  [-0.025, 0],
  [0.025, 0],
  [0, -0.02],
  [0, 0.02],
  [-0.04, -0.035],
  [0.04, -0.035],
  [-0.04, 0.035],
  [0.04, 0.035],
]

/**
 * Hit test used for the placement tap (and the wall reticle). On walls, feature points are sparse
 * and noisy, so several nearby samples are taken: the first usable hit is accepted even if the
 * exact tap point had none, at the median depth of all. Floors and tables are already smoothed
 * by the measured `height`.
 */
export function hitTestSurfaceForPlacement(
  XR8: XR8Api,
  camera: THREE.Camera,
  screenX: number,
  screenY: number,
  placement: PlacementType,
  height: SurfaceHeight,
): SurfaceHit | null {
  const first = hitTestSurface(XR8, camera, screenX, screenY, placement, height)
  if (placement !== 'wall' || (first && first.type !== 'FEATURE_POINT')) return first

  const samples = SAMPLE_OFFSETS.map(([dx, dy]) => hitTestSurface(XR8, camera, screenX + dx, screenY + dy, placement, height)).filter(
    (h): h is SurfaceHit => !!h && h.type === 'FEATURE_POINT',
  )
  const hit = first ?? samples[0]
  if (!hit || samples.length < 3) return hit ?? null

  // Keep the tapped direction but use the median depth along the camera ray.
  const median = samples.map((h) => h.distance).sort((a, b) => a - b)[Math.floor(samples.length / 2)]
  const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
  const dir = hit.position.clone().sub(origin).normalize()
  hit.position.copy(origin.addScaledVector(dir, median))
  hit.distance = median
  return hit
}

/** Yaw (around world Y) that turns an object's +Z front toward the camera. */
export function yawFacingCamera(objectPosition: THREE.Vector3, camera: THREE.Camera): number {
  const cam = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
  return Math.atan2(cam.x - objectPosition.x, cam.z - objectPosition.z)
}

/** Yaw that turns an object's +Z front to match a wall hit's outward normal. */
export function yawFromWall(hit: SurfaceHit): number {
  const normal = UP.clone().applyQuaternion(hit.surfaceRotation)
  return Math.atan2(normal.x, normal.z)
}

/** Placement reticle: a flat ring with a center dot that follows the detected surface. */
export class PlacementReticle {
  readonly object = new THREE.Group()
  private readonly ring: THREE.Mesh
  private readonly dot: THREE.Mesh
  private readonly target = new THREE.Vector3()
  private readonly targetRotation = new THREE.Quaternion()
  private hasTarget = false
  private elapsed = 0

  constructor() {
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.085, 0.1, 48).rotateX(-Math.PI / 2), ringMaterial)
    this.dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.018, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, depthWrite: false }),
    )
    this.ring.renderOrder = this.dot.renderOrder = 10
    this.object.add(this.ring, this.dot)
    this.object.visible = false
    this.object.name = 'placement-reticle'
  }

  /** Feed the latest hit (or null when no surface is under the screen center). */
  setHit(hit: SurfaceHit | null) {
    if (!hit) {
      this.hasTarget = false
      return
    }
    this.target.copy(hit.position)
    this.targetRotation.copy(hit.surfaceRotation)
    if (!this.hasTarget && !this.object.visible) {
      // Snap on first sighting rather than sliding in from the origin.
      this.object.position.copy(this.target)
      this.object.quaternion.copy(this.targetRotation)
    }
    this.hasTarget = true
  }

  update(dt: number, enabled: boolean, cameraDistance: number) {
    const show = enabled && this.hasTarget
    this.object.visible = show
    if (!show) return
    const k = 1 - Math.exp(-dt * 18)
    this.object.position.lerp(this.target, k)
    this.object.quaternion.slerp(this.targetRotation, k)
    // Keep the reticle readable at a distance, and give it a gentle "breathing" pulse.
    this.elapsed += dt
    const pulse = 1 + Math.sin(this.elapsed * 3.2) * 0.06
    const distanceScale = THREE.MathUtils.clamp(cameraDistance / 1.5, 0.6, 2.2)
    this.ring.scale.setScalar(pulse * distanceScale)
    this.dot.scale.setScalar(distanceScale)
  }

  dispose() {
    for (const mesh of [this.ring, this.dot]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.object.removeFromParent()
  }
}

/**
 * Dot grid painted on the detected surface (as in native "view in your room" viewers).
 * Dots are computed in world space, so they stay fixed on the real floor while the camera
 * moves — which also makes tracking quality visible to the user. The grid fades out radially
 * around its center (the reticle while placing, the product while dragging).
 */
export class SurfaceGrid {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial
  private readonly target = new THREE.Vector3()
  private hasTarget = false
  private opacity = 0
  private visible = false

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        center: { value: new THREE.Vector3() },
        radius: { value: 1.2 },
        spacing: { value: 0.09 },
        dotRadius: { value: 0.011 },
        opacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 center;
        uniform float radius;
        uniform float spacing;
        uniform float dotRadius;
        uniform float opacity;
        varying vec3 vWorld;
        void main() {
          vec2 cell = (fract(vWorld.xz / spacing) - 0.5) * spacing;
          float d = length(cell);
          float aa = fwidth(d) * 1.5;
          float dotMask = 1.0 - smoothstep(dotRadius - aa, dotRadius + aa, d);
          float r = distance(vWorld.xz, center.xz) / radius;
          float fade = 1.0 - smoothstep(0.35, 1.0, r);
          float alpha = dotMask * fade * opacity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material)
    this.mesh.name = 'surface-grid'
    this.mesh.renderOrder = 0
    this.mesh.visible = false
    this.mesh.raycast = () => undefined
  }

  /** Grid size for the product type: wide on floors, tighter on tables. */
  configure(placement: PlacementType) {
    const floor = placement === 'floor'
    const radius = floor ? 1.3 : 0.45
    this.material.uniforms.radius.value = radius
    this.material.uniforms.spacing.value = floor ? 0.09 : 0.04
    this.material.uniforms.dotRadius.value = floor ? 0.011 : 0.0055
    this.mesh.scale.set(radius * 2, 1, radius * 2)
  }

  /** Center the grid on a surface point, or pass null to fade it out. */
  show(point: THREE.Vector3 | null) {
    this.visible = !!point
    if (!point) return
    if (!this.hasTarget || this.opacity < 0.02) this.mesh.position.copy(point)
    this.target.copy(point)
    this.hasTarget = true
  }

  update(dt: number) {
    this.opacity += ((this.visible ? 1 : 0) - this.opacity) * (1 - Math.exp(-dt * (this.visible ? 8 : 4)))
    this.mesh.visible = this.opacity > 0.02
    if (!this.mesh.visible) return
    this.mesh.position.lerp(this.target, 1 - Math.exp(-dt * 12))
    this.material.uniforms.center.value.copy(this.mesh.position)
    this.material.uniforms.opacity.value = this.opacity * 0.85
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.mesh.removeFromParent()
  }
}

/** Soft blob shadow that grounds the product on the real surface (cheap: one textured quad). */
export class ContactShadow {
  readonly mesh: THREE.Mesh
  private readonly texture: THREE.CanvasTexture

  constructor() {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(0,0,0,0.55)')
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.28)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    this.texture = new THREE.CanvasTexture(canvas)

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, opacity: 0.85 }),
    )
    this.mesh.name = 'contact-shadow'
    this.mesh.position.y = 0.002 // avoid z-fighting with the (invisible) real surface
    this.mesh.renderOrder = 1
  }

  /** Fit the shadow to the model's footprint. */
  fit(size: THREE.Vector3) {
    this.mesh.scale.set(size.x * 1.25, 1, size.z * 1.25)
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.texture.dispose()
    this.mesh.removeFromParent()
  }
}
