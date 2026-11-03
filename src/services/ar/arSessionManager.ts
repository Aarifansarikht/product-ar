import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Product } from '../../types/product'
import { modelLibrary, type LoadedModel } from '../models/modelLibrary'
import { prepareForAR } from '../../utils/modelUtils'
import { ARUnavailableError, assertDeviceCompatible, loadXR8, preflightCheck } from './xr8Loader'
import {
  ContactShadow,
  PlacementReticle,
  SurfaceGrid,
  SurfaceHeight,
  sampleSurfaceHeight,
  assumedWallAt,
  DEFAULT_WALL_DEPTH,
  hitTestSurface,
  hitTestSurfaceForPlacement,
  yawFacingCamera,
  yawFromWall,
  type SurfaceHit,
} from './objectPlacement'
import { ObjectManipulator, TouchGestures } from './objectManipulation'
import { SelectionOutline } from './selectionOutline'
import { WallEstimator, WallPointsView } from './wallEstimator'
import { webXRSupported } from './webxrSupport'
import { WebXRTracking } from './webxrTracking'

/** After a wall placement, keep re-fitting the wall for this long as more points are tracked. */
const WALL_SETTLE_MS = 3500
const UP = new THREE.Vector3(0, 1, 0)
const DEBUG = new URLSearchParams(window.location.search).has('xrdebug')

export type ARPhase =
  | 'idle'
  | 'loading-engine'
  | 'requesting-camera'
  | 'awaiting-tap' // native AR needs a fresh tap to start (the original tap's gesture expired)
  | 'initializing' // camera live, SLAM calibrating
  | 'scanning' // tracking, no surface under the reticle yet
  | 'surface-found'
  | 'placed'
  | 'error'

export type ARErrorCode =
  | 'camera-denied'
  | 'motion-denied'
  | 'camera-unavailable'
  | 'unsupported-device'
  | 'unsupported-browser'
  | 'insecure-context'
  | 'sdk-failed'
  | 'model-failed'

export interface ARError {
  code: ARErrorCode
  title: string
  message: string
}

export interface ARState {
  phase: ARPhase
  /** webxr = native ARCore tracking (metric); xr8 = 8th Wall in-browser SLAM (fallback). */
  engine: 'webxr' | 'xr8' | null
  /** The browser ended the native AR session (e.g. system back); the viewer should close. */
  exited: boolean
  product: Product | null
  /** `lost` = tracking was established and has since degraded. */
  tracking: 'initializing' | 'normal' | 'lost'
  trackingReason: XR8TrackingReason | null
  modelLoading: boolean
  modelProgress: number
  /** The product is being touched/dragged (drives the outline and UI hints). */
  grabbing: boolean
  /** Product was replaced with one needing a different surface; user must tap again. */
  needsReplacement: boolean
  noSurfaceHint: boolean
  /** User's floor/table height correction, in metres (shown by the Adjust pad). */
  surfaceOffset: number
  lowPerformance: boolean
  scale: number
  error: ARError | null
}

export const AR_INITIAL_STATE: ARState = {
  phase: 'idle',
  engine: null,
  exited: false,
  product: null,
  tracking: 'initializing',
  trackingReason: null,
  modelLoading: false,
  modelProgress: 0,
  grabbing: false,
  needsReplacement: false,
  noSurfaceHint: false,
  surfaceOffset: 0,
  lowPerformance: false,
  scale: 1,
  error: null,
}

const NO_SURFACE_HINT_MS = 14_000
const HEIGHT_SETTLE_MS = 6000
const NUDGE_STEP = 0.01
/** The product stays visible through tracking drops shorter than this. */
const LOST_HIDE_AFTER_MS = 2500
/** Plain walls can take a while to show any trackable detail, so keep trying longer. */
const WALL_GUESS_SETTLE_MS = 20_000
const HIT_TEST_EVERY_N_FRAMES = 2
const LOW_FPS_THRESHOLD = 20
/** Rendering above 1.5x buys little on phones and steals frame time from tracking. */
const MAX_PIXEL_RATIO = 1.5
/** A tap may fall back to the reticle's last hit only if it is this fresh. */
const LAST_HIT_MAX_AGE_MS = 400

/**
 * Responsive-scale tracking starts instantly (no "walk around to calibrate" step). Its unit
 * scale comes from the camera's assumed height above the surface it initializes on, so these
 * typical heights make products appear close to real-world size: phone held while standing
 * over a floor, or held above a table / counter.
 */
const CAMERA_HEIGHT: Record<Product['placement'], number> = { floor: 1.4, tabletop: 0.5, wall: 1.4 }

const ERROR_COPY: Record<ARErrorCode, Omit<ARError, 'code'>> = {
  'camera-denied': {
    title: 'Camera access needed',
    message:
      'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.',
  },
  'motion-denied': {
    title: 'Motion sensors needed',
    message:
      'World tracking needs access to your device’s motion sensors. Tap “Try again” and choose Allow when prompted. If no prompt appears, reload the page.',
  },
  'camera-unavailable': {
    title: 'Camera unavailable',
    message: 'We could not start your camera. Close other apps that may be using it and try again.',
  },
  'unsupported-device': {
    title: 'AR not available',
    message: 'AR is not available on this device. Please open this page on an iPhone or Android phone.',
  },
  'unsupported-browser': {
    title: 'Browser not supported',
    message: 'AR is not available in this browser. Please try Safari on iPhone or Chrome on Android.',
  },
  'insecure-context': {
    title: 'Secure connection required',
    message: 'Camera-based AR only works over HTTPS. Please open the secure (https://) version of this page.',
  },
  'sdk-failed': {
    title: 'AR failed to start',
    message: 'The AR engine could not be initialized on this device. Please reload and try again.',
  },
  'model-failed': {
    title: 'Model unavailable',
    message: 'This product’s 3D model could not be loaded. Check your connection or choose another product.',
  },
}

const makeError = (code: ARErrorCode, message?: string): ARError => ({
  code,
  ...ERROR_COPY[code],
  ...(message ? { message } : {}),
})

/** Maps camera / engine failures to user-facing error codes. */
function classifyError(err: unknown): ARErrorCode {
  if (err instanceof ARUnavailableError) {
    switch (err.code) {
      case 'unsupported-device':
        return 'unsupported-device'
      case 'unsupported-browser':
      case 'no-camera-api':
      case 'no-webgl':
        return 'unsupported-browser'
      case 'insecure-context':
        return 'insecure-context'
      default:
        return 'sdk-failed'
    }
  }
  // XR8 reports permission failures as { type: 'permission', status: 'denied', permission }.
  const engine = err as { type?: string; permission?: string } | null
  if (engine?.type === 'permission') {
    return engine.permission === 'deviceorientation' || engine.permission === 'devicemotion'
      ? 'motion-denied'
      : 'camera-denied'
  }
  const name = (err as { name?: string })?.name ?? ''
  const text = `${name} ${String((err as { message?: string })?.message ?? err)}`.toLowerCase()
  if (name === 'NotAllowedError' || text.includes('permission') || text.includes('denied')) return 'camera-denied'
  if (['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError'].includes(name) || text.includes('camera'))
    return 'camera-unavailable'
  return 'sdk-failed'
}

type Listener = () => void

/**
 * Drives a single 8th Wall world-tracking session rendered with Three.js.
 *
 * Pipeline: GlTextureRenderer (camera feed) → Threejs (scene/camera synced to the SLAM pose)
 * → XrController (world tracking, hit tests) → this manager's module (placement, gestures,
 * per-frame updates). Everything per-frame lives here, outside React; React only observes
 * coarse state through `subscribe`/`getState`.
 */
export class ARSessionManager {
  private state: ARState = AR_INITIAL_STATE
  private readonly listeners = new Set<Listener>()

  private XR8: XR8Api | null = null
  private webxr: WebXRTracking | null = null
  /** Latest native plane hit under the screen center (WebXR only). */
  private xrHit: SurfaceHit | null = null
  private xr: XR8ThreejsScene | null = null
  private canvas: HTMLCanvasElement | null = null
  private overlayRoot: HTMLElement | null = null
  private gestures: TouchGestures | null = null
  private running = false
  private disposed = false

  private readonly reticle = new PlacementReticle()
  private readonly shadow = new ContactShadow()
  private readonly manipulator = new ObjectManipulator()
  private readonly grid = new SurfaceGrid()
  private readonly outline = new SelectionOutline()
  /** Holds the placed product; hidden while tracking is lost so it never floats in a wrong spot. */
  private readonly content = new THREE.Group()
  /** Surface type the tracking session's ground was initialized for. */
  private trackingSurface: Product['placement'] = 'floor'
  private readonly wallEstimator = new WallEstimator()
  /** Measured floor/table height under the reticle (from real tracked points and planes). */
  private readonly surfaceHeight = new SurfaceHeight()
  private readonly wallPoints = new WallPointsView()
  private wallSettleUntil = 0
  private lastHitAt = 0
  /** A tap that landed before the model finished loading. */
  private pendingPlacement: { hit: SurfaceHit; placement: Product['placement'] } | null = null
  /** Until then, a product placed on an assumed height is moved onto the measured surface. */
  private heightSettleUntil = 0
  /** Until then, art hung on an assumed wall is moved onto the real wall once it is measured. */
  private wallGuessUntil = 0
  /** Distance to the wall ahead, for the assumed wall (last measured, or a typical room distance). */
  private wallDepth = DEFAULT_WALL_DEPTH
  /** User correction of the floor/table height (Adjust ↑↓), in metres. */
  private surfaceOffset = 0
  /** When tracking was lost (0 = tracking). */
  private lostSince = 0
  private readonly lights = new THREE.Group()
  private envTexture: THREE.Texture | null = null
  private hemi: THREE.HemisphereLight | null = null
  private sun: THREE.DirectionalLight | null = null

  private model: LoadedModel | null = null
  private modelRequest = 0
  private lastHit: SurfaceHit | null = null
  private frame = 0
  private lastTime = 0
  private scanStartedAt = 0
  private fps = { frames: 0, since: 0, lowWindows: 0 }
  private pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  private exposure = 1

  // ---- observable state -------------------------------------------------------------

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = () => this.state

  private set(patch: Partial<ARState>) {
    let changed = false
    for (const key in patch) {
      if (this.state[key as keyof ARState] !== patch[key as keyof ARState]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  private fail(code: ARErrorCode, message?: string) {
    if (this.disposed) return
    console.error('[AR]', code, message ?? '')
    // A model failure is recoverable in-session: camera and tracking keep running underneath.
    if (code === 'model-failed') this.set({ error: makeError(code, message) })
    else this.set({ phase: 'error', error: makeError(code, message) })
  }

  // ---- lifecycle ----------------------------------------------------------------------

  /**
   * Starts AR on the best available engine: native WebXR (ARCore) when the browser has it,
   * otherwise 8th Wall. `overlayRoot` is the element kept on screen over native AR (the UI).
   */
  async start(canvas: HTMLCanvasElement, gestureSurface: HTMLElement, overlayRoot: HTMLElement, product: Product) {
    this.canvas = canvas
    this.overlayRoot = overlayRoot
    this.set({ ...AR_INITIAL_STATE, phase: 'loading-engine', product })

    try {
      preflightCheck()
    } catch (err) {
      return this.fail(classifyError(err), (err as Error).message)
    }

    // Fetch the model in parallel with the engine start-up.
    this.loadProduct(product)
    this.setupGestures(gestureSurface)

    if (await webXRSupported()) {
      if (!this.disposed) void this.startWebXR(false)
      return
    }
    await this.startXR8()
  }

  /**
   * Native ARCore session. The browser only grants it during a user gesture: the "View in AR"
   * tap normally still counts; if it has expired, the viewer shows a start button
   * (`awaiting-tap`) that calls this again with `fromTap`.
   */
  async startWebXR(fromTap: boolean) {
    if (this.disposed || !this.overlayRoot || this.webxr) return
    this.set({ phase: 'requesting-camera', engine: 'webxr', error: null })
    const tracking = new WebXRTracking()
    try {
      await tracking.start(this.overlayRoot, this.onXRFrame)
    } catch (err) {
      tracking.dispose()
      if (this.disposed) return
      const name = (err as { name?: string })?.name
      console.warn('[AR] native AR session failed', name, err)
      // No gesture yet (or the camera prompt was dismissed): ask for a tap. A refusal after that
      // tap is a real denial. Anything else (ARCore missing/unsupported) falls back to 8th Wall.
      if (name === 'SecurityError' || name === 'NotAllowedError') {
        if (!fromTap) return this.set({ phase: 'awaiting-tap', engine: null })
        if (name === 'NotAllowedError') return this.fail('camera-denied')
      }
      this.set({ engine: null })
      return this.startXR8()
    }
    if (this.disposed) return tracking.dispose()

    this.webxr = tracking
    tracking.onEnd = () => {
      if (!this.disposed) this.set({ exited: true })
    }
    this.xr = { scene: tracking.scene, camera: tracking.camera, renderer: tracking.renderer }
    this.setupScene()
    this.running = true
    this.scanStartedAt = performance.now()
    this.set({ phase: 'initializing' })
  }

  /** Per native AR frame: tracking status, plane hit, anchor correction, then the shared update. */
  private onXRFrame = (frame: XRFrame) => {
    const tracking = this.webxr
    if (!tracking || this.disposed) return
    const status = tracking.trackingStatus(frame)
    if (status === 'normal') this.onTrackingStatus('NORMAL', undefined)
    else this.onTrackingStatus('LIMITED', status === 'initializing' ? 'INITIALIZING' : undefined)

    const placement = this.state.product?.placement
    this.xrHit = placement && (!this.manipulator.isPlaced || this.heightSettleUntil > performance.now() || this.wallGuessUntil > 0) ? tracking.centerHit(frame, placement, this.surfaceHeight) : null
    const drift = tracking.anchorDrift(frame)
    if (drift && this.manipulator.isPlaced) this.manipulator.shift(drift)

    this.onUpdate({})
    tracking.render()
  }

  private async startXR8() {
    const canvas = this.canvas!
    const product = this.state.product!
    this.set({ phase: 'loading-engine' })
    let XR8: XR8Api
    try {
      XR8 = await loadXR8()
      assertDeviceCompatible(XR8)
    } catch (err) {
      return this.fail(classifyError(err), err instanceof ARUnavailableError ? err.message : undefined)
    }
    if (this.disposed) return
    this.XR8 = XR8
    this.set({ engine: 'xr8' })

    this.resizeCanvas()
    window.addEventListener('resize', this.resizeCanvas)

    try {
      this.trackingSurface = product.placement
      XR8.XrController.configure({
        // Responsive scale tracks immediately; 'absolute' needs a slow metric calibration first.
        scale: 'responsive',
        disableWorldTracking: false,
        enableLighting: true,
        // The tracked point cloud is only needed to fit wall planes.
        enableWorldPoints: product.placement === 'wall',
      })
      XR8.clearCameraPipelineModules()
      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(),
        this.pipelineModule(),
      ])
      this.set({ phase: 'requesting-camera' })
      XR8.run({
        canvas,
        allowedDevices: XR8.XrConfig.device().MOBILE_AND_HEADSETS,
        webgl2: true,
        cameraConfig: { direction: 'back' },
        // Append ?xrdebug to the URL to get the engine's verbose logs when diagnosing a device.
        verbose: DEBUG,
      })
      // Debug-only handle for inspecting the session from the console.
      if (DEBUG) (window as unknown as { __arSession?: ARSessionManager }).__arSession = this
      this.running = true
    } catch (err) {
      console.error('[AR] XR8 run failed', err)
      this.fail(classifyError(err))
    }
  }

  private setupGestures(gestureSurface: HTMLElement) {
    this.gestures = new TouchGestures(gestureSurface, {
      // Only a touch that lands on the product grabs it; touching empty space never moves it.
      onPressStart: (x, y) => {
        const grabbed = !!this.xr && this.manipulator.beginDrag(this.toNdc(x, y), this.xr.camera)
        if (grabbed) this.setGrabbing(true)
        return grabbed
      },
      onPressEnd: () => {
        const wasDragging = this.manipulator.isDragging
        this.manipulator.endDrag()
        this.setGrabbing(false)
        if (!wasDragging) return
        // Native AR: anchor the product at its new spot. 8th Wall: snap wall items back onto the fitted wall.
        if (this.webxr) this.webxr.setAnchor(this.manipulator.position)
        else if (this.state.product?.placement === 'wall') this.wallSettleUntil = performance.now() + 1500
      },
      onTap: this.handleTap,
      onDragStart: () => undefined,
      onDragMove: (x, y) => this.xr && this.manipulator.drag(this.toNdc(x, y), this.xr.camera),
      onDragEnd: () => this.manipulator.endDrag(),
      onTwist: (radians) => {
        if (!this.manipulator.isPlaced || this.state.product?.placement === 'wall') return
        this.manipulator.rotateBy(radians)
        this.setGrabbing(true)
      },
      onPinch: (factor) => {
        if (!this.manipulator.isPlaced || !this.state.product?.scale.allowScale) return
        this.manipulator.scaleBy(factor)
        this.setGrabbing(true)
        this.set({ scale: Math.round(this.manipulator.scale * 100) / 100 })
      },
    })
  }

  /** Stops the camera, tears down the pipeline and frees every GPU resource we created. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.modelRequest++
    window.removeEventListener('resize', this.resizeCanvas)
    this.gestures?.dispose()
    this.gestures = null

    if (this.XR8 && this.running) {
      try {
        this.XR8.stop()
        this.XR8.clearCameraPipelineModules()
      } catch (err) {
        console.warn('[AR] error while stopping XR8', err)
      }
    }
    // Ends the native session (camera off) and stops its render loop before resources go.
    this.webxr?.dispose()
    this.webxr = null
    this.running = false

    this.detachModel()
    this.reticle.dispose()
    this.grid.dispose()
    this.wallPoints.dispose()
    this.wallEstimator.clear()
    this.surfaceHeight.clear()
    this.outline.dispose()
    this.shadow.dispose()
    this.envTexture?.dispose()
    this.lights.removeFromParent()
    this.hemi?.dispose()
    this.sun?.dispose()
    this.content.removeFromParent()
    modelLibrary.clear()
    this.xr = null
    this.listeners.clear()
  }

  // ---- user actions -------------------------------------------------------------------

  /** Swap the product without restarting the camera or losing tracking. */
  replaceProduct(product: Product) {
    if (product.id === this.state.product?.id) return
    this.set({ product, grabbing: false })
    this.loadProduct(product)
  }

  rotate(direction: 'left' | 'right') {
    if (this.state.product?.placement === 'wall') return // wall items stay aligned with the wall
    const step = THREE.MathUtils.degToRad(this.state.product?.rotation.step ?? 45)
    this.manipulator.rotateBy(direction === 'left' ? step : -step)
  }

  /**
   * Full re-track: clears the placement and restarts world tracking from the current view, so
   * the product can be placed fresh somewhere else (or after tracking has degraded).
   */
  retrack() {
    if (!this.xr) return
    this.manipulator.endDrag()
    this.manipulator.hide()
    this.setGrabbing(false)
    this.lastHit = null
    this.xrHit = null
    this.reticle.setHit(null)
    this.wallEstimator.clear()
    this.clearSurface()
    this.wallSettleUntil = 0
    this.heightSettleUntil = 0
    this.pendingPlacement = null
    this.wallGuessUntil = 0
    // Native AR keeps its (metric) map of the room; only 8th Wall restarts tracking here.
    this.webxr?.clearAnchor()
    if (this.XR8) {
      this.applyCameraOrigin()
      this.XR8.XrController.recenter()
    }
    this.scanStartedAt = performance.now()
    this.set({ phase: 'scanning', needsReplacement: false, noSurfaceHint: false })
  }

  /**
   * Fine adjustment in 1 cm steps. Placed product: `y` raises/lowers it (wall art: up/down the
   * wall), `x` slides it sideways as seen from the camera (along the wall for art). Before
   * placing, `y` raises/lowers the floor/table dots when they sit above or below the real surface.
   * A height change also corrects the surface for later placements.
   */
  nudge(axis: 'x' | 'y', direction: 1 | -1) {
    const product = this.state.product
    if (!this.xr || !product) return
    const step = NUDGE_STEP * direction
    const wall = product.placement === 'wall'
    if (axis === 'y' && !wall) {
      this.surfaceOffset += step
      this.set({ surfaceOffset: Math.round(this.surfaceOffset * 100) / 100 })
    }
    if (!this.manipulator.isPlaced) return

    const delta = new THREE.Vector3()
    if (axis === 'y') {
      delta.y = step
    } else {
      const right = new THREE.Vector3().setFromMatrixColumn(this.xr.camera.matrixWorld, 0)
      if (wall) {
        const yaw = this.manipulator.yaw
        const normal = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
        right.addScaledVector(normal, -right.dot(normal))
      }
      right.setY(0)
      if (right.lengthSq() < 1e-6) return
      delta.copy(right.normalize()).multiplyScalar(step)
    }
    this.heightSettleUntil = 0 // the user's adjustment wins over automatic height settling
    this.manipulator.shift(delta)
    this.webxr?.setAnchor(this.manipulator.position)
  }

  resetPlacement() {
    this.manipulator.reset()
    this.webxr?.setAnchor(this.manipulator.position)
    this.set({ scale: this.state.product?.defaultScale ?? 1 })
  }

  retry() {
    this.set({ error: null })
    if (this.state.product && this.model?.productId !== this.state.product.id) this.loadProduct(this.state.product)
  }

  // ---- internals ----------------------------------------------------------------------

  private loadProduct(product: Product) {
    const request = ++this.modelRequest
    this.set({ modelLoading: true, modelProgress: 0 })
    modelLibrary
      .load(product, (fraction) => {
        if (request === this.modelRequest) this.set({ modelProgress: Math.round(fraction * 100) / 100 })
      })
      .then((model) => {
        if (request !== this.modelRequest || this.disposed) return
        this.attachModel(model, product)
        this.set({ modelLoading: false, modelProgress: 1 })
      })
      .catch((err) => {
        if (request !== this.modelRequest || this.disposed) return
        console.error(err)
        this.set({ modelLoading: false })
        this.fail('model-failed', `The 3D model for ${product.name} could not be loaded. Please choose another product or try again.`)
      })
  }

  private attachModel(model: LoadedModel, product: Product) {
    const wasPlaced = this.manipulator.isPlaced
    const previousType = this.manipulator.group.userData.placement as Product['placement'] | undefined
    if (previousType !== product.placement) this.clearSurface()

    this.detachModel()
    if (this.xr) prepareForAR(model.root, this.xr.renderer.capabilities.getMaxAnisotropy())
    this.model = model
    this.manipulator.group.add(model.root)
    const wall = product.placement === 'wall'
    this.XR8?.XrController.configure({ enableWorldPoints: wall })
    // Wall items hang centered on the anchor point with their back against the wall.
    model.root.position.set(0, wall ? -model.size.y / 2 : 0, wall ? model.size.z / 2 : 0)
    this.shadow.fit(model.size)
    this.shadow.mesh.visible = !wall
    this.manipulator.group.userData.placement = product.placement
    this.outline.attach(model.root)
    this.grid.configure(product.placement)
    this.manipulator.configure({
      scaleMin: product.scale.allowScale ? product.scale.min : product.defaultScale,
      scaleMax: product.scale.allowScale ? product.scale.max : product.defaultScale,
      size: model.size,
      wall,
    })
    this.set({ scale: product.defaultScale })

    if (!wasPlaced) {
      this.retargetTracking(product.placement)
      const pending = this.pendingPlacement
      this.pendingPlacement = null
      if (pending?.placement === product.placement) this.place(pending.hit)
      return
    }
    if (previousType === product.placement && this.xr) {
      // Same kind of surface: keep the anchor position, reset rotation and scale.
      const yaw = wall
        ? this.manipulator.group.rotation.y // keep facing out of the same wall
        : yawFacingCamera(this.manipulator.group.position, this.xr.camera) + THREE.MathUtils.degToRad(product.rotation.initialYaw)
      this.manipulator.rebase(yaw, product.defaultScale)
    } else {
      // A floor product can't stay on a table or wall (and so on): ask for a new placement.
      this.manipulator.hide()
      this.set({ phase: 'scanning', needsReplacement: true })
      this.scanStartedAt = performance.now()
    }
    this.retargetTracking(product.placement)
  }

  /**
   * Re-initializes the tracking ground for a different kind of surface (floor <-> table), so
   * the new product's ground plane and scale match what the camera is now looking at.
   */
  private retargetTracking(placement: Product['placement']) {
    if (!this.XR8 || !this.xr || placement === this.trackingSurface || this.manipulator.isPlaced) return
    const sameGround = CAMERA_HEIGHT[placement] === CAMERA_HEIGHT[this.trackingSurface]
    this.trackingSurface = placement
    if (sameGround) return // e.g. floor <-> wall share the same floor-based tracking
    this.lastHit = null
    this.reticle.setHit(null)
    this.applyCameraOrigin()
    this.XR8.XrController.recenter()
    this.clearSurface() // recentering moves the world origin
  }

  /** Tells the engine where the camera starts: above the ground, at the typical height. */
  private applyCameraOrigin() {
    if (!this.XR8 || !this.xr) return
    const { camera } = this.xr
    camera.position.set(0, CAMERA_HEIGHT[this.trackingSurface], 0)
    camera.quaternion.identity()
    this.XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion })
  }

  private setGrabbing(grabbing: boolean) {
    this.outline.setActive(grabbing)
    this.set({ grabbing })
  }

  private detachModel() {
    if (!this.model) return
    this.outline.detach()
    this.model.root.position.set(0, 0, 0)
    this.model.root.removeFromParent()
    modelLibrary.detached(this.model)
    this.model = null
  }

  private place(hit: SurfaceHit) {
    if (!this.xr || !this.state.product) return
    const product = this.state.product
    // Tapped while the 3D model is still downloading: place it there as soon as it is ready.
    if (!this.model) {
      this.pendingPlacement = { hit, placement: product.placement }
      return
    }
    this.pendingPlacement = null
    const yaw =
      product.placement === 'wall'
        ? yawFromWall(hit)
        : yawFacingCamera(hit.position, this.xr.camera) + THREE.MathUtils.degToRad(product.rotation.initialYaw)
    this.manipulator.place(hit.position, yaw, product.defaultScale)
    this.webxr?.setAnchor(hit.position)
    if (product.placement === 'wall' && !this.webxr) this.wallSettleUntil = performance.now() + WALL_SETTLE_MS
    // Placed on the assumed surface height: drop/raise it onto the real one once it is measured.
    this.heightSettleUntil = !hit.confirmed && product.placement !== 'wall' ? performance.now() + HEIGHT_SETTLE_MS : 0
    // Hung on an assumed wall: move onto the real wall once it is measured.
    this.wallGuessUntil = !hit.confirmed && product.placement === 'wall' ? performance.now() + WALL_GUESS_SETTLE_MS : 0
    this.navigatorVibrate()
    this.set({ phase: 'placed', needsReplacement: false, noSurfaceHint: false, scale: product.defaultScale })
  }

  private handleTap = (clientX: number, clientY: number) => {
    if (!this.xr || !this.state.product || this.state.error) return
    // Once placed, the product stays anchored; it only moves when grabbed and dragged.
    if (this.manipulator.isPlaced) return
    const { x, y } = this.toScreen(clientX, clientY)
    const fresh = performance.now() - this.lastHitAt < LAST_HIT_MAX_AGE_MS ? this.lastHit : null
    const hit = this.findSurface(x, y) ?? fresh
    if (hit) this.place(hit)
  }

  /**
   * Best surface under a screen point; walls use the fitted plane before raw feature points, and
   * (unless `assume` is false) an assumed wall when nothing on the wall is tracked yet.
   */
  private findSurface(screenX: number, screenY: number, reticle = false, assume = true): SurfaceHit | null {
    const hit = this.findRawSurface(screenX, screenY, reticle, assume)
    if (!hit || !this.surfaceOffset || !this.xr || this.state.product?.placement === 'wall') return hit
    // The user raised/lowered the dots: slide the hit along the view ray to the adjusted height,
    // so the marker stays under the screen point.
    const camPos = this.xr.camera.position
    const dir = hit.position.clone().sub(camPos)
    const t = (hit.position.y + this.surfaceOffset - camPos.y) / dir.y
    if (!Number.isFinite(t) || t <= 0) return hit
    const position = camPos.clone().addScaledVector(dir, t)
    return { ...hit, position, distance: position.distanceTo(camPos) }
  }

  private findRawSurface(screenX: number, screenY: number, reticle: boolean, assume: boolean): SurfaceHit | null {
    // Native AR places where the reticle is: a real detected plane under the screen center.
    if (this.webxr) return this.xrHit
    if (!this.XR8 || !this.xr || !this.state.product) return null
    const { placement } = this.state.product
    const camera = this.xr.camera
    if (placement !== 'wall') {
      return reticle
        ? hitTestSurface(this.XR8, camera, screenX, screenY, placement, this.surfaceHeight)
        : hitTestSurfaceForPlacement(this.XR8, camera, screenX, screenY, placement, this.surfaceHeight)
    }
    const wall = this.wallEstimator.fitAlongRay(camera, screenX, screenY)
    const hit: SurfaceHit | null = wall
      ? {
          position: wall.point,
          surfaceRotation: new THREE.Quaternion().setFromUnitVectors(UP, wall.normal),
          type: 'WALL_PLANE',
          confirmed: true,
          distance: wall.point.distanceTo(camera.position),
        }
      : hitTestSurfaceForPlacement(this.XR8, camera, screenX, screenY, placement, this.surfaceHeight)
    const forward = camera.getWorldDirection(new THREE.Vector3())
    if (hit) {
      // Remember how far the real wall is; the assumed wall uses it when tracking loses the wall.
      const depth = hit.position.clone().sub(camera.position).dot(forward.setY(0).normalize())
      if (depth > 0.4 && depth < 6) this.wallDepth = depth
      return hit
    }
    if (!assume) return null
    // Plain wall: estimate its distance from any points ahead, easing so the marker does not jump.
    const ahead = this.wallEstimator.depthAhead(camera.position, forward, performance.now())
    if (ahead !== null) this.wallDepth += (ahead - this.wallDepth) * 0.2
    return assumedWallAt(camera, screenX, screenY, this.wallDepth)
  }

  /**
   * Art placed on an assumed wall (plain wall, nothing tracked) moves onto the real wall as soon
   * as it is measured: along the view ray through the art, so it stays where the user put it on
   * screen and only its depth and angle are corrected.
   */
  private settleGuessedWall(now: number) {
    if (!this.xr || this.manipulator.isDragging) return
    if (now > this.wallGuessUntil) {
      this.wallGuessUntil = 0
      return
    }
    const camera = this.xr.camera
    let hit: SurfaceHit | null = null
    if (this.webxr) {
      hit = this.xrHit // screen-center hit, refreshed every frame while settling
    } else {
      const s = this.manipulator.position.clone().project(camera)
      if (Math.abs(s.x) > 1 || Math.abs(s.y) > 1 || s.z > 1) return // art is off screen
      hit = this.findSurface((s.x + 1) / 2, (1 - s.y) / 2, false, false)
    }
    if (!hit?.confirmed) return
    const normal = UP.clone().applyQuaternion(hit.surfaceRotation)
    const wall = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.position)
    const dir = this.manipulator.position.clone().sub(camera.position).normalize()
    const onWall = new THREE.Ray(camera.position.clone(), dir).intersectPlane(wall, new THREE.Vector3())
    if (!onWall || onWall.distanceTo(this.manipulator.position) > 2.5) return // a different surface
    this.wallGuessUntil = 0
    this.manipulator.refineAnchor(onWall, Math.atan2(normal.x, normal.z))
    this.webxr?.setAnchor(onWall)
    if (!this.webxr) this.wallSettleUntil = now + WALL_SETTLE_MS // keep refining as points accumulate
  }

  /**
   * A product placed before the surface was measured keeps sampling it, and moves onto the real
   * height once known — so it stands on the floor rather than floating above or sinking into it.
   */
  private settleHeight(now: number) {
    const product = this.state.product
    if (!this.xr || !product || this.manipulator.isDragging) return
    if (this.XR8) {
      sampleSurfaceHeight(this.XR8, this.xr.camera, product.placement, this.surfaceHeight)
      this.findSurface(0.5, 0.5, true) // feeds the height estimate; native AR does this per frame
    }
    const measured = this.surfaceHeight.value(now)
    if (measured === null) return
    this.heightSettleUntil = 0
    const dy = measured + this.surfaceOffset - this.manipulator.position.y
    if (Math.abs(dy) < 0.005 || Math.abs(dy) > 0.6) return // already there / a different surface
    this.manipulator.shift(new THREE.Vector3(0, dy, 0))
    this.webxr?.setAnchor(this.manipulator.position)
  }

  /** Forgets the measured surface height and the user's height correction (new surface). */
  private clearSurface() {
    this.surfaceHeight.clear()
    this.surfaceOffset = 0
    this.set({ surfaceOffset: 0 })
  }

  /** Keeps placed wall art flush with the wall while the estimate improves. */
  private settleOnWall(now: number) {
    if (!this.xr || now > this.wallSettleUntil || this.frame % 8 !== 0 || !this.manipulator.isPlaced) return
    const anchor = this.manipulator.group.position
    const wall = this.wallEstimator.fitNear(anchor, this.xr.camera.position)
    if (!wall || wall.inliers < 10) return
    // Ignore implausible jumps (a different surface): settle only small corrections.
    if (wall.point.distanceTo(anchor) > 0.35) return
    this.manipulator.refineAnchor(wall.point, Math.atan2(wall.normal.x, wall.normal.z))
  }

  private pipelineModule(): XR8PipelineModule {
    return {
      name: 'bay81-product-placement',
      onStart: () => this.onStart(),
      onUpdate: ({ processCpuResult }) => this.onUpdate(processCpuResult),
      onCameraStatusChange: ({ status, reason }) => {
        // The camera also restarts after the app was in the background; a placed product stays placed.
        if (status === 'requesting') {
          if (!this.manipulator.isPlaced) this.set({ phase: 'requesting-camera' })
        } else if (status === 'hasVideo' && this.state.phase === 'requesting-camera') {
          this.set({ phase: 'initializing' })
          this.scanStartedAt = performance.now()
        } else if (status === 'failed') {
          // XR8 reasons: DENY_CAMERA (NotAllowedError), NO_CAMERA (NotFoundError), UNSPECIFIED.
          console.error('[AR] camera failed:', reason)
          this.fail(reason === 'DENY_CAMERA' ? 'camera-denied' : 'camera-unavailable')
        }
      },
      onException: (err) => {
        console.error('[AR] XR8 exception', err)
        this.fail(classifyError(err))
      },
      listeners: [
        {
          event: 'reality.trackingstatus',
          process: ({ detail }) => this.onTrackingStatus(detail?.status, detail?.reason),
        },
      ],
    }
  }

  private onStart() {
    if (!this.XR8) return
    this.xr = this.XR8.Threejs.xrScene()
    // Camera starts above the ground plane (y = 0); see CAMERA_HEIGHT.
    this.applyCameraOrigin()
    this.setupScene()
  }

  /** Lighting and scene content, shared by both engines. */
  private setupScene() {
    if (!this.xr) return
    const { scene, renderer } = this.xr

    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1

    // Image-based lighting gives PBR materials believable reflections at near-zero per-frame cost.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    this.envTexture = pmrem.fromScene(room, 0.04).texture
    room.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    pmrem.dispose()
    // The GL context is shared with XR8, which saves/restores GL state around its own camera
    // drawing. PMREM's program was just deleted while still bound, so unbind it and resync
    // Three's state cache; otherwise XR8 would restore (useProgram) a deleted program.
    renderer.getContext().useProgram(null)
    renderer.resetState()
    scene.environment = this.envTexture
    scene.environmentIntensity = 0.8

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.9)
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4)
    this.sun.position.set(1.5, 4, 2)
    this.lights.add(this.hemi, this.sun)
    scene.add(this.lights)

    this.manipulator.group.add(this.shadow.mesh)
    this.content.add(this.manipulator.group)
    scene.add(this.grid.mesh, this.wallPoints.points, this.reticle.object, this.content)
    if (this.model) prepareForAR(this.model.root, renderer.capabilities.getMaxAnisotropy())
    this.lastTime = performance.now()
    this.fps.since = this.lastTime
  }

  private onTrackingStatus(status: XR8TrackingStatus | undefined, reason: XR8TrackingReason | undefined) {
    if (status === 'NORMAL') {
      const patch: Partial<ARState> = { tracking: 'normal', trackingReason: null }
      if (this.state.phase === 'initializing' || this.state.phase === 'requesting-camera') {
        patch.phase = 'scanning'
        this.scanStartedAt = performance.now()
      }
      this.set(patch)
    } else if (status === 'LIMITED') {
      const hadTracking = this.state.tracking !== 'initializing'
      this.set({
        tracking: hadTracking && reason !== 'INITIALIZING' ? 'lost' : this.state.tracking,
        trackingReason: reason ?? null,
      })
    }
  }

  private onUpdate(processCpuResult: Record<string, unknown>) {
    if (!this.xr) return
    const now = performance.now()
    const dt = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now
    this.frame++

    this.monitorPerformance(now)
    this.applyLightEstimate(processCpuResult, dt)

    // While tracking is lost the pose is unreliable: hide the product rather than show it drifting
    // or at the wrong size. It reappears on its anchor as soon as tracking recovers.
    // Brief drops are common up close (the camera sees mostly plain floor or the area under the
    // product), so keep showing it on its anchor and hide only if tracking stays lost.
    if (this.state.tracking !== 'lost') this.lostSince = 0
    else this.lostSince ||= now
    this.content.visible = !this.lostSince || now - this.lostSince < LOST_HIDE_AFTER_MS

    // Wall fitting from the 8th Wall point cloud; native AR detects vertical planes itself.
    const onWall = this.state.product?.placement === 'wall' && !this.webxr
    if (onWall) {
      const reality = processCpuResult.reality as { worldPoints?: unknown } | undefined
      this.wallEstimator.ingest(reality?.worldPoints, now)
      this.settleOnWall(now)
    }

    const placing = !this.manipulator.isPlaced && this.state.phase !== 'error'
    if (placing && this.state.product && this.frame % HIT_TEST_EVERY_N_FRAMES === 0) {
      if (this.XR8) sampleSurfaceHeight(this.XR8, this.xr.camera, this.state.product.placement, this.surfaceHeight)
      this.lastHit = this.findSurface(0.5, 0.5, true)
      if (this.lastHit) this.lastHitAt = now
      this.reticle.setHit(this.lastHit)

      // A surface is usable as soon as the engine returns a hit; no need to wait for full tracking.
      const looking = this.state.phase === 'scanning' || this.state.phase === 'initializing'
      if (looking && this.lastHit) this.set({ phase: 'surface-found', noSurfaceHint: false })
      else if (this.state.phase === 'surface-found' && !this.lastHit) this.set({ phase: 'scanning' })
      else if (
        this.state.phase === 'scanning' &&
        !this.state.noSurfaceHint &&
        now - this.scanStartedAt > NO_SURFACE_HINT_MS
      )
        this.set({ noSurfaceHint: true })
    }
    if (!placing && this.heightSettleUntil > now && this.frame % HIT_TEST_EVERY_N_FRAMES === 0) this.settleHeight(now)
    if (!placing && this.wallGuessUntil > 0 && this.frame % 6 === 0) this.settleGuessedWall(now)

    const camPos = this.xr.camera.position
    // The reticle and dots show right away, even while the 3D model is still downloading.
    const showReticle = placing
    this.reticle.update(dt, showReticle, this.reticle.object.position.distanceTo(camPos))
    this.manipulator.update(dt)

    // Dot grid: around the reticle while placing, around the product while it is dragged. It
    // appears on the first frame (assumed height) and glides onto the measured surface.
    const horizontal = this.state.product?.placement !== 'wall'
    if (horizontal && showReticle && this.lastHit) this.grid.show(this.reticle.object.position)
    else if (horizontal && this.manipulator.isDragging) this.grid.show(this.manipulator.group.position)
    else this.grid.show(null)
    this.grid.update(dt)
    // On walls, show the tracked wall points as dots while placing or dragging.
    if (this.frame % 4 === 0) this.wallPoints.update(this.wallEstimator, now, onWall && (placing || this.manipulator.isDragging))
    this.outline.update(dt)
  }

  /** Uses 8th Wall's exposure estimate (when present) so the product matches the room's brightness. */
  private applyLightEstimate(result: Record<string, unknown>, dt: number) {
    const reality = result.reality as { lighting?: { exposure?: number } } | undefined
    const exposure = reality?.lighting?.exposure
    if (typeof exposure !== 'number' || !Number.isFinite(exposure)) return
    const target = THREE.MathUtils.clamp(1 + exposure, 0.45, 1.5)
    this.exposure += (target - this.exposure) * (1 - Math.exp(-dt * 2))
    if (this.hemi) this.hemi.intensity = 0.9 * this.exposure
    if (this.sun) this.sun.intensity = 1.4 * this.exposure
  }

  /** Detect sustained low frame rates and adapt by lowering render resolution once. */
  private monitorPerformance(now: number) {
    this.fps.frames++
    const elapsed = now - this.fps.since
    if (elapsed < 2000) return
    const fps = (this.fps.frames * 1000) / elapsed
    this.fps = { frames: 0, since: now, lowWindows: fps < LOW_FPS_THRESHOLD ? this.fps.lowWindows + 1 : 0 }
    if (this.fps.lowWindows >= 2 && !this.state.lowPerformance) {
      this.set({ lowPerformance: true })
      if (this.pixelRatio > 1) {
        this.pixelRatio = 1
        this.resizeCanvas()
      }
    }
  }

  private resizeCanvas = () => {
    const canvas = this.canvas
    if (!canvas) return
    const width = Math.round(window.innerWidth * this.pixelRatio)
    const height = Math.round(window.innerHeight * this.pixelRatio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
  }

  /** Client coordinates → normalized 0..1 screen coordinates used by XR8 hit tests. */
  private toScreen(clientX: number, clientY: number) {
    const rect = this.canvas!.getBoundingClientRect()
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
  }

  /** Client coordinates → normalized device coordinates for Three.js raycasting. */
  private toNdc(clientX: number, clientY: number) {
    const { x, y } = this.toScreen(clientX, clientY)
    return new THREE.Vector2(x * 2 - 1, -(y * 2 - 1))
  }

  private navigatorVibrate() {
    try {
      navigator.vibrate?.(12)
    } catch {
      /* not supported */
    }
  }
}
