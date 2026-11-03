import * as THREE from 'three'

interface Transform {
  position: THREE.Vector3
  yaw: number
  scale: number
}

const cloneTransform = (t: Transform): Transform => ({ position: t.position.clone(), yaw: t.yaw, scale: t.scale })

/** Shortest signed angle from a to b. */
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/** Grab tolerance around the product's bounds, so small items are easy to pick up. */
const GRAB_PADDING = 0.15
const MIN_GRAB_SIZE = 0.12

/**
 * Owns the transform of the placed product.
 *
 * Coordinate system (8th Wall + Three.js, right-handed, Y-up): floor/table products move across
 * the surface plane on world X and Z, with Y locked to the surface height; wall products move
 * within the vertical wall plane. Rotation is yaw around world Y.
 *
 * The product is world-anchored: nothing here depends on the camera except while the user is
 * actively dragging it. A drag only starts when the touch lands on the product itself, so
 * handling the phone or touching empty space never nudges it.
 */
export class ObjectManipulator {
  /** Add this group to the scene; the model and its shadow are its children. */
  readonly group = new THREE.Group()

  private initial: Transform = { position: new THREE.Vector3(), yaw: 0, scale: 1 }
  private target: Transform = cloneTransform(this.initial)
  private current: Transform = cloneTransform(this.initial)
  private scaleRange = { min: 1, max: 1 }
  /** Model bounds in the group's local space (footprint centered, resting on y = 0). */
  private readonly localBounds = new THREE.Box3()

  private readonly raycaster = new THREE.Raycaster()
  /** The surface the product is constrained to (horizontal, or vertical for wall items). */
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private onWall = false
  private readonly dragOffset = new THREE.Vector3()
  private readonly hitPoint = new THREE.Vector3()
  private readonly localRay = new THREE.Ray()
  private readonly inverse = new THREE.Matrix4()
  private dragging = false

  constructor() {
    this.group.name = 'placed-product'
    this.group.visible = false
  }

  get isPlaced() {
    return this.group.visible
  }

  get isDragging() {
    return this.dragging
  }

  get scale() {
    return this.target.scale
  }

  /** Where the product rests (not the eased, on-screen position). */
  get position(): Readonly<THREE.Vector3> {
    return this.target.position
  }

  get yaw() {
    return this.target.yaw
  }

  configure(options: { scaleMin: number; scaleMax: number; size: THREE.Vector3; wall: boolean }) {
    this.scaleRange = { min: options.scaleMin, max: options.scaleMax }
    this.onWall = options.wall
    const { x, y, z } = options.size
    const hx = Math.max(x, MIN_GRAB_SIZE) / 2 + GRAB_PADDING * x
    const hy = Math.max(y, MIN_GRAB_SIZE) * (1 + GRAB_PADDING)
    const hz = Math.max(z, MIN_GRAB_SIZE) / 2 + GRAB_PADDING * z
    if (options.wall) {
      // Wall items hang centered on their anchor, protruding forward (+Z) from the wall.
      this.localBounds.set(new THREE.Vector3(-hx, -hy / 2, -0.02), new THREE.Vector3(hx, hy / 2, Math.max(z, 0.05) + 0.05))
    } else {
      this.localBounds.set(new THREE.Vector3(-hx, 0, -hz), new THREE.Vector3(hx, hy, hz))
    }
  }

  /** Constrain movement to the plane through `position` (floor/table: horizontal; wall: facing `yaw`). */
  private setPlane(position: THREE.Vector3, yaw: number) {
    const normal = this.onWall ? new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)) : new THREE.Vector3(0, 1, 0)
    this.plane.setFromNormalAndCoplanarPoint(normal, position)
  }

  /** Anchor the product at a surface point. This becomes the "reset" pose. */
  place(position: THREE.Vector3, yaw: number, scale: number) {
    this.initial = { position: position.clone(), yaw, scale }
    this.target = cloneTransform(this.initial)
    // Appear instantly at the tapped point, with a quick, subtle settle.
    this.current = { position: position.clone(), yaw, scale: scale * 0.9 }
    this.setPlane(position, yaw)
    this.group.visible = true
    this.apply()
  }

  hide() {
    this.group.visible = false
    this.dragging = false
  }

  reset() {
    this.target = cloneTransform(this.initial)
    this.setPlane(this.initial.position, this.initial.yaw)
  }

  /** Re-applies the initial pose with a fresh yaw/scale (used when the product is replaced). */
  rebase(yaw: number, scale: number) {
    this.initial = { position: this.target.position.clone(), yaw, scale }
    this.target = cloneTransform(this.initial)
    this.current.scale = scale * 0.9
  }

  /**
   * Settles a wall item onto a better wall estimate (more feature points have been tracked).
   * Updates the anchor itself — and the reset pose — so it stays flush from every angle.
   */
  refineAnchor(position: THREE.Vector3, yaw: number) {
    if (this.dragging) return
    this.target.position.copy(position)
    this.target.yaw = yaw
    this.initial.position.copy(position)
    this.initial.yaw = yaw
    this.setPlane(position, yaw)
  }

  /**
   * Applies a tracking-map correction (the anchor moved): shifts the product and its reset pose
   * without easing, so it stays on the same real-world spot instead of sliding there.
   */
  shift(delta: THREE.Vector3) {
    if (this.dragging) return
    this.target.position.add(delta)
    this.initial.position.add(delta)
    this.current.position.add(delta)
    this.plane.translate(delta)
  }

  rotateBy(radians: number) {
    this.target.yaw += radians
  }

  scaleBy(factor: number) {
    this.target.scale = THREE.MathUtils.clamp(this.target.scale * factor, this.scaleRange.min, this.scaleRange.max)
  }

  /** True when the screen point (NDC) is on — or very near — the placed product. */
  hitsObject(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    if (!this.isPlaced) return false
    this.raycaster.setFromCamera(ndc, camera)
    this.group.updateMatrixWorld()
    this.inverse.copy(this.group.matrixWorld).invert()
    this.localRay.copy(this.raycaster.ray).applyMatrix4(this.inverse)
    return this.localRay.intersectsBox(this.localBounds)
  }

  /** Begin dragging if the touch starts on the product. `ndc` is in normalized device coordinates. */
  beginDrag(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    if (!this.hitsObject(ndc, camera) || !this.intersectSurface(ndc, camera)) return false
    this.dragOffset.subVectors(this.target.position, this.hitPoint)
    // Keep only the in-plane part of the grab offset.
    this.dragOffset.addScaledVector(this.plane.normal, -this.dragOffset.dot(this.plane.normal))
    this.dragging = true
    return true
  }

  drag(ndc: THREE.Vector2, camera: THREE.Camera) {
    if (!this.dragging || !this.intersectSurface(ndc, camera)) return
    const next = this.hitPoint.add(this.dragOffset)
    // Ignore rays that graze the horizon and would fling the product far away.
    if (next.distanceTo(this.target.position) > 3) return
    this.plane.projectPoint(next, this.target.position)
  }

  endDrag() {
    this.dragging = false
  }

  update(dt: number) {
    if (!this.isPlaced) return
    // Follow the finger tightly while dragging; otherwise settle onto the target.
    const k = 1 - Math.exp(-dt * (this.dragging ? 28 : 16))
    this.current.position.lerp(this.target.position, k)
    this.current.yaw += angleDelta(this.current.yaw, this.target.yaw) * (1 - Math.exp(-dt * 12))
    this.current.scale += (this.target.scale - this.current.scale) * (1 - Math.exp(-dt * 16))
    this.apply()
  }

  private apply() {
    this.group.position.copy(this.current.position)
    this.group.rotation.set(0, this.current.yaw, 0)
    this.group.scale.setScalar(this.current.scale)
  }

  private intersectSurface(ndc: THREE.Vector2, camera: THREE.Camera) {
    this.raycaster.setFromCamera(ndc, camera)
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.hitPoint)
    if (!hit) return false
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld)
    return hit.distanceTo(camPos) < 12
  }
}

export interface GestureHandlers {
  /** First finger down. Return true to grab immediately (the touch landed on the product). */
  onPressStart(x: number, y: number): boolean
  /** Last finger lifted. */
  onPressEnd(): void
  onTap(x: number, y: number): void
  onDragStart(x: number, y: number): void
  onDragMove(x: number, y: number): void
  onDragEnd(): void
  onTwist(radians: number): void
  onPinch(factor: number): void
}

const TAP_SLOP_PX = 10
const TAP_MAX_MS = 350

/**
 * Lightweight pointer-gesture recognizer for the AR surface:
 * one finger → tap or drag, two fingers → twist (rotate) and pinch (scale).
 * Runs entirely outside React; handlers are invoked directly from DOM events.
 */
export class TouchGestures {
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private start = { x: 0, y: 0, t: 0 }
  private dragging = false
  private lastAngle = 0
  private lastSpread = 0

  constructor(
    private readonly element: HTMLElement,
    private readonly handlers: GestureHandlers,
  ) {
    element.addEventListener('pointerdown', this.onDown)
    element.addEventListener('pointermove', this.onMove)
    element.addEventListener('pointerup', this.onUp)
    element.addEventListener('pointercancel', this.onUp)
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.onDown)
    this.element.removeEventListener('pointermove', this.onMove)
    this.element.removeEventListener('pointerup', this.onUp)
    this.element.removeEventListener('pointercancel', this.onUp)
    this.pointers.clear()
  }

  private twoFingerMetrics() {
    const [a, b] = [...this.pointers.values()]
    return { angle: Math.atan2(b.y - a.y, b.x - a.x), spread: Math.hypot(b.x - a.x, b.y - a.y) }
  }

  private onDown = (e: PointerEvent) => {
    try {
      this.element.setPointerCapture?.(e.pointerId)
    } catch {
      // The pointer may already have ended (or be synthetic); tracking still works without capture.
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 1) {
      this.start = { x: e.clientX, y: e.clientY, t: performance.now() }
      // Touching the product grabs it right away — no movement threshold, like native AR viewers.
      this.dragging = this.handlers.onPressStart(e.clientX, e.clientY)
    } else if (this.pointers.size === 2) {
      if (this.dragging) this.handlers.onDragEnd()
      this.dragging = false
      const m = this.twoFingerMetrics()
      this.lastAngle = m.angle
      this.lastSpread = m.spread
    }
  }

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY

    if (this.pointers.size === 1) {
      const moved = Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y)
      if (!this.dragging && moved > TAP_SLOP_PX) {
        this.dragging = true
        this.handlers.onDragStart(this.start.x, this.start.y)
      }
      if (this.dragging) this.handlers.onDragMove(e.clientX, e.clientY)
    } else if (this.pointers.size === 2) {
      const m = this.twoFingerMetrics()
      const dAngle = Math.atan2(Math.sin(m.angle - this.lastAngle), Math.cos(m.angle - this.lastAngle))
      // Screen Y points down, so a clockwise twist on screen should turn the product clockwise
      // as seen from above (negative yaw).
      if (Math.abs(dAngle) > 0.002) this.handlers.onTwist(-dAngle)
      if (this.lastSpread > 0 && m.spread > 0) this.handlers.onPinch(m.spread / this.lastSpread)
      this.lastAngle = m.angle
      this.lastSpread = m.spread
    }
  }

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return
    const wasSingle = this.pointers.size === 1
    this.pointers.delete(e.pointerId)
    if (wasSingle) {
      if (this.dragging) {
        this.handlers.onDragEnd()
      } else if (
        performance.now() - this.start.t < TAP_MAX_MS &&
        Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) < TAP_SLOP_PX
      ) {
        this.handlers.onTap(e.clientX, e.clientY)
      }
      this.dragging = false
      this.handlers.onPressEnd()
    } else if (this.pointers.size === 1) {
      // Lifting one finger of a two-finger gesture: restart single-finger tracking without a jump.
      const [rest] = [...this.pointers.values()]
      this.start = { x: rest.x, y: rest.y, t: 0 }
      this.dragging = false
    }
  }
}
