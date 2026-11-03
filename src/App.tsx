import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Product } from './types/product'
import { getProduct } from './config/products'
import { SplashScreen } from './components/splash/SplashScreen'
import { HomePage } from './pages/HomePage'
import { requestMotionPermission } from './services/ar/permissions'
import { prefetchAREngine } from './services/ar/prefetch'

// Three.js + the AR runtime live in a separate chunk so the dashboard loads instantly.
const loadARViewer = () => import('./components/ar/ARViewer')
const ARViewer = lazy(() => loadARViewer().then((m) => ({ default: m.ARViewer })))

type Screen = 'splash' | 'home' | 'ar'

const SELECTED_KEY = 'bay81.selectedProduct'

function readStoredProduct(): Product | null {
  try {
    const id = sessionStorage.getItem(SELECTED_KEY)
    return id ? (getProduct(id) ?? null) : null
  } catch {
    return null
  }
}

function storeProduct(product: Product) {
  try {
    sessionStorage.setItem(SELECTED_KEY, product.id)
  } catch {
    /* storage unavailable (private mode) — the in-memory selection still works */
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash')
  const [selected, setSelected] = useState<Product | null>(readStoredProduct)

  const finishSplash = useCallback(() => setScreen((s) => (s === 'splash' ? 'home' : s)), [])

  const openAR = useCallback((product: Product) => {
    // Must run inside the tap handler: iOS only shows the motion-sensor prompt for user gestures.
    void requestMotionPermission()
    storeProduct(product)
    setSelected(product)
    setScreen('ar')
    // Give the AR view a history entry so the hardware/browser back button exits AR.
    window.history.pushState({ screen: 'ar' }, '')
  }, [])

  const exitAR = useCallback(() => {
    if (window.history.state?.screen === 'ar') window.history.back()
    else setScreen('home')
  }, [])

  // Warm the AR chunk once the dashboard is idle, so "View in AR" opens without a delay.
  useEffect(() => {
    if (screen !== 'home') return
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    idle(() => {
      void loadARViewer()
      prefetchAREngine()
    })
  }, [screen])

  useEffect(() => {
    const onPop =() => setScreen((s) => (s === 'ar' ? 'home' : s))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const changeProduct = useCallback((product: Product) => {
    storeProduct(product)
    setSelected(product)
  }, [])

  return (
    <AnimatePresence mode="wait">
      {screen === 'splash' && <SplashScreen key="splash" onDone={finishSplash} />}
      {screen === 'home' && <HomePage key="home" onSelectProduct={openAR} />}
      {screen === 'ar' && selected && (
        // Keyed per AR visit only; replacing a product inside AR keeps the same session.
        <Suspense key="ar" fallback={<div className="ambient-bg fixed inset-0" />}>
          <ARViewer product={selected} onExit={exitAR} onProductChange={changeProduct} />
        </Suspense>
      )}
    </AnimatePresence>
  )
}
