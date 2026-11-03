import * as THREE from 'three'

/** Vendored copy of @8thwall/engine-binary (see scripts/prepare-assets.mjs). */
const ENGINE_URL = `${import.meta.env.BASE_URL}external/xr/xr.js`
const LOAD_TIMEOUT_MS = 30_000

export class ARUnavailableError extends Error {
  constructor(
    public readonly code:
      | 'engine-load-failed'
      | 'insecure-context'
      | 'unsupported-device'
      | 'unsupported-browser'
      | 'no-camera-api'
      | 'no-webgl',
    message: string,
  ) {
    super(message)
    this.name = 'ARUnavailableError'
  }
}

let enginePromise: Promise<XR8Api> | null = null

/** Injects xr.js once, waits for `xrloaded`, then loads the SLAM (world tracking) chunk. */
export function loadXR8(): Promise<XR8Api> {
  if (enginePromise) return enginePromise

  enginePromise = new Promise<XR8Api>((resolve, reject) => {
    // XR8.Threejs.pipelineModule() builds its scene/renderer from window.THREE.
    window.THREE = THREE

    if (window.XR8) return resolve(window.XR8)

    const timer = window.setTimeout(
      () => reject(new ARUnavailableError('engine-load-failed', 'The AR engine took too long to load.')),
      LOAD_TIMEOUT_MS,
    )
    window.addEventListener(
      'xrloaded',
      () => {
        window.clearTimeout(timer)
        window.XR8 ? resolve(window.XR8) : reject(new ARUnavailableError('engine-load-failed', 'XR8 failed to initialize.'))
      },
      { once: true },
    )

    const script = document.createElement('script')
    script.src = ENGINE_URL
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => {
      window.clearTimeout(timer)
      reject(new ARUnavailableError('engine-load-failed', 'The AR engine could not be downloaded.'))
    }
    document.head.appendChild(script)
  })
    .then(async (XR8) => {
      await XR8.loadChunk('slam')
      return XR8
    })
    .catch((err) => {
      enginePromise = null // allow a retry
      throw err instanceof ARUnavailableError
        ? err
        : new ARUnavailableError('engine-load-failed', 'World tracking could not be loaded.')
    })

  return enginePromise
}

/** Fast checks that don't need the engine. */
export function preflightCheck(): void {
  if (!window.isSecureContext) {
    throw new ARUnavailableError('insecure-context', 'AR requires a secure (HTTPS) connection.')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new ARUnavailableError('no-camera-api', 'This browser does not provide camera access.')
  }
  const probe = document.createElement('canvas')
  if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
    throw new ARUnavailableError('no-webgl', 'WebGL is not available on this device.')
  }
}

/** Uses the engine's own device/browser compatibility rules (world tracking is mobile-only). */
export function assertDeviceCompatible(XR8: XR8Api): void {
  const allowedDevices = XR8.XrConfig.device().MOBILE_AND_HEADSETS
  if (XR8.XrDevice.isDeviceBrowserCompatible({ allowedDevices })) return

  const reasons = XR8.XrDevice.incompatibleReasons({ allowedDevices })
  const R = XR8.XrDevice.IncompatibilityReasons
  if (reasons.includes(R.UNSUPPORTED_OS)) {
    throw new ARUnavailableError(
      'unsupported-device',
      'AR is not available on this device. Please open this page on an iPhone or Android phone.',
    )
  }
  throw new ARUnavailableError(
    'unsupported-browser',
    'AR is not available in this browser. Please try Safari on iPhone or Chrome on Android.',
  )
}
