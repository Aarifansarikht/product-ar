// Free of Three.js imports so the dashboard can run the check early (see prefetch.ts).

/** Append ?engine=8thwall to the URL to force the 8th Wall engine (for comparison/debugging). */
const FORCE_8THWALL = new URLSearchParams(window.location.search).get('engine') === '8thwall'

let support: Promise<boolean> | null = null

/**
 * True when the browser offers native, ARCore-backed WebXR AR (Chrome on Android). That
 * tracking is metric (true scale), detects real planes and corrects anchors as it maps the
 * room — the same tracking native "view in your room" viewers use. Cached after the first call
 * so the session can be requested while the user's tap still counts as a gesture.
 */
export function webXRSupported(): Promise<boolean> {
  if (FORCE_8THWALL || !navigator.xr) return Promise.resolve(false)
  support ??= navigator.xr.isSessionSupported('immersive-ar').catch(() => false)
  return support
}
