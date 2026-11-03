// Warms the browser HTTP cache so "View in AR" starts quickly. Deliberately free of Three.js
// imports so it can run from the dashboard without pulling in the AR chunk.

import { webXRSupported } from './webxrSupport'

const ENGINE_FILES =['external/xr/xr.js', 'external/xr/xr-slam.js']
const prefetched = new Set<string>()

function prefetch(href: string, as: 'script' | 'fetch') {
  if (prefetched.has(href)) return
  prefetched.add(href)
  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.as = as
  link.href = href
  if (as === 'script') link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
}

/** World tracking is phone-only, so desktop visitors never download the engine. */
const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false

export function prefetchAREngine() {
  if (!isTouchDevice()) return
  // Resolving native AR support now lets "View in AR" request the session within the tap.
  void webXRSupported().then((native) => {
    if (native) return // ARCore phones never need the 8th Wall engine
    const base = import.meta.env.BASE_URL
    for (const file of ENGINE_FILES) prefetch(base + file, 'script')
  })
}

/** Call when the user shows intent (touches a product card). */
export function prefetchModel(modelPath: string) {
  prefetch(modelPath, 'fetch')
}
