/**
 * Minimal typings for the subset of the 8th Wall engine (XR8, @8thwall/engine-binary 1.x)
 * used by this app. Every member listed here was verified against the shipped binary.
 */
import type * as THREE_NS from 'three'

declare global {
  type XR8HitTestType = 'FEATURE_POINT' | 'ESTIMATED_SURFACE' | 'DETECTED_SURFACE'

  interface XR8HitTestResult {
    type: XR8HitTestType | 'UNSPECIFIED'
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number; w: number }
    distance: number
  }

  type XR8CameraStatus = 'requesting' | 'hasStream' | 'hasVideo' | 'failed'
  type XR8TrackingStatus = 'NORMAL' | 'LIMITED' | 'NOT_AVAILABLE'
  type XR8TrackingReason =
    | 'UNSPECIFIED'
    | 'INITIALIZING'
    | 'RELOCALIZING'
    | 'TOO_MUCH_MOTION'
    | 'NOT_ENOUGH_TEXTURE'

  interface XR8ThreejsScene {
    scene: THREE_NS.Scene
    camera: THREE_NS.PerspectiveCamera
    renderer: THREE_NS.WebGLRenderer
  }

  interface XR8PipelineModule {
    name: string
    onStart?: (args: { canvas: HTMLCanvasElement; canvasWidth: number; canvasHeight: number }) => void
    onUpdate?: (args: { processCpuResult: Record<string, unknown> }) => void
    onCanvasSizeChange?: (args: { canvasWidth: number; canvasHeight: number }) => void
    onDeviceOrientationChange?: (args: { orientation: number }) => void
    onCameraStatusChange?: (args: { status: XR8CameraStatus; reason?: string }) => void
    onException?: (error: unknown) => void
    onDetach?: () => void
    listeners?: { event: string; process: (event: { name: string; detail: any }) => void }[]
  }

  interface XR8Api {
    addCameraPipelineModules(modules: XR8PipelineModule[]): void
    clearCameraPipelineModules(): void
    run(config: {
      canvas: HTMLCanvasElement
      allowedDevices?: unknown
      webgl2?: boolean
      ownRunLoop?: boolean
      cameraConfig?: { direction?: 'back' | 'front' }
      glContextConfig?: WebGLContextAttributes
      verbose?: boolean
    }): void
    stop(): void
    pause(): void
    resume(): void
    isPaused(): boolean
    loadChunk(chunk: 'slam' | 'face'): Promise<void>
    GlTextureRenderer: { pipelineModule(): XR8PipelineModule }
    Threejs: { pipelineModule(): XR8PipelineModule; xrScene(): XR8ThreejsScene }
    XrController: {
      pipelineModule(): XR8PipelineModule
      configure(options: {
        scale?: 'responsive' | 'absolute'
        disableWorldTracking?: boolean
        enableLighting?: boolean
        enableWorldPoints?: boolean
      }): void
      hitTest(x: number, y: number, includedTypes?: XR8HitTestType[]): XR8HitTestResult[]
      recenter(): void
      updateCameraProjectionMatrix(options: {
        origin?: { x: number; y: number; z: number }
        facing?: { x: number; y: number; z: number; w: number }
      }): void
    }
    XrConfig: { device(): { MOBILE: unknown; MOBILE_AND_HEADSETS: unknown; ANY: unknown } }
    XrDevice: {
      isDeviceBrowserCompatible(options?: { allowedDevices?: unknown }): boolean
      incompatibleReasons(options?: { allowedDevices?: unknown }): number[]
      IncompatibilityReasons: Record<string, number>
    }
  }

  interface Window {
    XR8?: XR8Api
    THREE?: typeof THREE_NS
  }
}

export {}
