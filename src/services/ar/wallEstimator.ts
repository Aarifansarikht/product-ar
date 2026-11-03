import * as THREE from 'three'

export interface WallPlane {
  /** Horizontal unit normal, pointing toward the viewer. */
  normal: THREE.Vector3
  /** A point on the wall where the query ray (or anchor) meets it. */
  point: THREE.Vector3
  inliers: number
}

interface TrackedPoint {
  position: THREE.Vector3
  seenAt: number
}

const MAX_POINTS = 1500
/** Points older than this are dropped (the map may have shifted). */
const POINT_TTL_MS = 8000
const INLIER_DISTANCE = 0.03
const MIN_INLIERS = 7
const RANSAC_ITERATIONS = 90
/** Most points used for one wall fit. */
const MAX_FIT_POINTS = 350
/** Candidate points must lie within this angle of the query ray. */
const RAY_CONE_COS = Math.cos(THREE.MathUtils.degToRad(18))
/** Points within this angle of the view direction count as "ahead" for the depth estimate. */
const AHEAD_CONE_COS = Math.cos(THREE.MathUtils.degToRad(30))

/**
 * Estimates vertical wall planes from the engine's tracked feature points.
 *
 * A single feature-point hit gives a noisy depth and no orientation, so artwork anchored to one
 * appears to slide when the camera moves. Instead this accumulates the world points 8th Wall
 * tracks across frames and fits a vertical plane with RANSAC + least squares. Anchoring to that
 * plane keeps the art flush against the real wall from any viewing angle.
 */
export class WallEstimator {
  private readonly points = new Map<number, TrackedPoint>()
  private readonly ray = new THREE.Ray()
  private readonly raycaster = new THREE.Raycaster()

  /** Feed `processCpuResult.reality.worldPoints` (requires `enableWorldPoints`). */
  ingest(worldPoints: unknown, now: number) {
    if (!Array.isArray(worldPoints)) return
    for (const p of worldPoints as { id: number; position: { x: number; y: number; z: number } }[]) {
      const existing = this.points.get(p.id)
      if (existing) {
        existing.position.set(p.position.x, p.position.y, p.position.z)
        existing.seenAt = now
      } else {
        this.points.set(p.id, { position: new THREE.Vector3(p.position.x, p.position.y, p.position.z), seenAt: now })
      }
    }
    if (this.points.size > MAX_POINTS || Math.random() < 0.05) this.prune(now)
  }

  clear() {
    this.points.clear()
  }

  /** Recently seen points, for the on-screen "detected wall" dots. */
  recentPoints(now: number, out: THREE.Vector3[], max: number) {
    out.length = 0
    for (const p of this.points.values()) {
      if (now - p.seenAt < 1500) out.push(p.position)
      if (out.length >= max) break
    }
    return out
  }

  /** Fits the wall seen along a camera ray through normalized screen coords (0..1). */
  fitAlongRay(camera: THREE.Camera, screenX: number, screenY: number): WallPlane | null {
    this.raycaster.setFromCamera(new THREE.Vector2(screenX * 2 - 1, -(screenY * 2 - 1)), camera)
    this.ray.copy(this.raycaster.ray)
    const toPoint = new THREE.Vector3()
    const candidates: THREE.Vector3[] = []
    for (const { position } of this.points.values()) {
      toPoint.subVectors(position, this.ray.origin)
      const distance = toPoint.length()
      if (distance < 0.3 || distance > 6) continue
      if (toPoint.dot(this.ray.direction) / distance < RAY_CONE_COS) continue
      candidates.push(position)
    }
    const plane = this.fit(candidates, this.ray.origin)
    if (!plane) return null
    const hit = this.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.point), new THREE.Vector3())
    // Reject grazing views where the ray barely meets the wall.
    if (!hit || Math.abs(this.ray.direction.dot(plane.normal)) < 0.25) return null
    return { ...plane, point: hit }
  }

  /**
   * Rough distance to whatever is ahead (median horizontal depth of recent points near the view
   * direction). Too few points to fit a wall can still say how far away it is — e.g. a frame
   * edge, outlet or the corner of a plain wall.
   */
  depthAhead(origin: THREE.Vector3, viewDirection: THREE.Vector3, now: number): number | null {
    const forward = viewDirection.clone().setY(0)
    if (forward.lengthSq() < 0.05) return null
    forward.normalize()
    const toPoint = new THREE.Vector3()
    const depths: number[] = []
    for (const { position, seenAt } of this.points.values()) {
      if (now - seenAt > 3000) continue
      toPoint.subVectors(position, origin)
      const distance = toPoint.length()
      if (distance < 0.4 || distance > 5 || toPoint.dot(viewDirection) / distance < AHEAD_CONE_COS) continue
      depths.push(toPoint.dot(forward))
    }
    if (depths.length < 3) return null
    return depths.sort((a, b) => a - b)[Math.floor(depths.length / 2)]
  }

  /** Re-fits the wall around an existing anchor (used to settle placed art onto the wall). */
  fitNear(anchor: THREE.Vector3, viewer: THREE.Vector3, radius = 0.9): WallPlane | null {
    const candidates: THREE.Vector3[] = []
    for (const { position } of this.points.values()) {
      if (position.distanceTo(anchor) < radius) candidates.push(position)
    }
    const plane = this.fit(candidates, viewer)
    if (!plane) return null
    const wall = new THREE.Plane().setFromNormalAndCoplanarPoint(plane.normal, plane.point)
    return { ...plane, point: wall.projectPoint(anchor, new THREE.Vector3()) }
  }

  private fit(candidates: THREE.Vector3[], viewer: THREE.Vector3): WallPlane | null {
    if (candidates.length < MIN_INLIERS) return null
    // This runs every few frames while aiming; a random subset fits the wall just as well.
    if (candidates.length > MAX_FIT_POINTS) {
      for (let i = 0; i < MAX_FIT_POINTS; i++) {
        const j = i + ((Math.random() * (candidates.length - i)) | 0)
        ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
      }
      candidates.length = MAX_FIT_POINTS
    }

    // Count inliers without allocating per iteration; collect them once for the best plane.
    let bestCount = 0
    let bestNx = 0
    let bestNz = 0
    let bestD = 0
    for (let i = 0; i < RANSAC_ITERATIONS; i++) {
      const a = candidates[(Math.random() * candidates.length) | 0]
      const b = candidates[(Math.random() * candidates.length) | 0]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz)
      if (len < 0.08) continue
      // Vertical plane through a and b: its normal is horizontal and perpendicular to (dx, dz).
      const nx = -dz / len
      const nz = dx / len
      const d = -(nx * a.x + nz * a.z)
      let count = 0
      for (const p of candidates) if (Math.abs(nx * p.x + nz * p.z + d) < INLIER_DISTANCE) count++
      if (count > bestCount) {
        bestCount = count
        bestNx = nx
        bestNz = nz
        bestD = d
      }
    }
    if (bestCount < MIN_INLIERS) return null
    const bestInliers = candidates.filter((p) => Math.abs(bestNx * p.x + bestNz * p.z + bestD) < INLIER_DISTANCE)

    // Least-squares refinement: the wall normal is the direction of least spread in X/Z.
    let cx = 0
    let cz = 0
    let cy = 0
    for (const p of bestInliers) {
      cx += p.x
      cy += p.y
      cz += p.z
    }
    cx /= bestInliers.length
    cy /= bestInliers.length
    cz /= bestInliers.length
    let sxx = 0
    let sxz = 0
    let szz = 0
    for (const p of bestInliers) {
      const x = p.x - cx
      const z = p.z - cz
      sxx += x * x
      sxz += x * z
      szz += z * z
    }
    // Eigenvector of the smaller eigenvalue of [[sxx, sxz], [sxz, szz]].
    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz) // direction of largest spread
    const wallNormal = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle))
    const centroid = new THREE.Vector3(cx, cy, cz)
    if (wallNormal.dot(new THREE.Vector3().subVectors(viewer, centroid)) < 0) wallNormal.negate()
    return { normal: wallNormal, point: centroid, inliers: bestInliers.length }
  }

  private prune(now: number) {
    for (const [id, p] of this.points) if (now - p.seenAt > POINT_TTL_MS) this.points.delete(id)
    if (this.points.size <= MAX_POINTS) return
    const oldest = [...this.points.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt)
    for (let i = 0; i < oldest.length - MAX_POINTS; i++) this.points.delete(oldest[i][0])
  }
}

/** Renders recently tracked wall feature points as small dots — live feedback that the wall is being detected. */
export class WallPointsView {
  readonly points: THREE.Points
  private readonly geometry = new THREE.BufferGeometry()
  private readonly positions: Float32Array
  private readonly scratch: THREE.Vector3[] = []

  constructor(private readonly max = 400) {
    this.positions = new Float32Array(max * 3)
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setDrawRange(0, 0)
    this.points = new THREE.Points(
      this.geometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }),
    )
    this.points.name = 'wall-points'
    this.points.frustumCulled = false
    this.points.visible = false
    this.points.raycast = () => undefined
  }

  update(estimator: WallEstimator, now: number, visible: boolean) {
    this.points.visible = visible
    if (!visible) return
    const pts = estimator.recentPoints(now, this.scratch, this.max)
    pts.forEach((p, i) => p.toArray(this.positions, i * 3))
    this.geometry.setDrawRange(0, pts.length)
    this.geometry.attributes.position.needsUpdate = true
  }

  dispose() {
    this.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.points.removeFromParent()
  }
}
