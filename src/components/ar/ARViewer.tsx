import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Camera, Repeat2 } from 'lucide-react'
import type { Product } from '../../types/product'
import { useARSession } from '../../hooks/useARSession'
import { ARControls } from './ARControls'
import { ARErrorScreen } from './ARErrorScreen'
import { ARLoadingScreen } from './ARLoadingScreen'
import { ARPlacementReticle } from './ARPlacementReticle'
import { ARProductSelector } from './ARProductSelector'
import { ARInstructions, ARPerformanceToast, ARScaleChip, ARTapToPlace, ARTrackingIndicator } from './ARStatus'
import { ProductPreview3D } from '../common/ProductPreview3D'
import { requestMotionPermission } from '../../services/ar/permissions'

interface ARViewerProps {
  product: Product
  onExit: () => void
  onProductChange: (product: Product) => void
}

const BOOT_PHASES = new Set(['idle', 'loading-engine', 'requesting-camera'])

export function ARViewer({ product, onExit, onProductChange }: ARViewerProps) {
  const { canvasRef, surfaceRef, rootRef, state, session, restart, attempt } = useARSession(product)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const current = state.product ?? product
  const booting = BOOT_PHASES.has(state.phase) && !state.error
  const awaitingTap = state.phase === 'awaiting-tap' && !state.error
  const placed = state.phase === 'placed'
  const showChrome = !booting && !awaitingTap && !state.error
  // Native AR draws the camera behind this element (DOM overlay), so it must stay see-through.
  const nativeAR = state.engine === 'webxr'

  // The browser ended native AR (system back button, app switch): leave the AR screen too.
  useEffect(() => {
    if (state.exited) onExit()
  }, [state.exited, onExit])

  const replace = useCallback(
    (next: Product) => {
      setSelectorOpen(false)
      session?.replaceProduct(next)
      onProductChange(next)
    },
    [session, onProductChange],
  )

  const retry = useCallback(() => {
    if (state.error?.code === 'model-failed') return session?.retry()
    // Re-ask for motion sensors while we are still inside the user's tap (required on iOS).
    void requestMotionPermission()
    restart()
  }, [state.error, session, restart])

  return (
    <motion.div
      ref={rootRef}
      className={`fixed inset-0 z-40 overflow-hidden select-none ${nativeAR ? 'bg-transparent' : 'bg-black'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* Camera feed + world-tracked Three.js scene, rendered by the 8th Wall pipeline. Native AR
          renders on its own layer; the canvas stays (invisible) so screen-to-ray math keeps its size. */}
      <canvas key={attempt} ref={canvasRef} className={`ar-canvas ${nativeAR ? 'invisible' : ''}`} />

      {/* Gesture surface: taps place, drags move, two-finger twist rotates, pinch scales. */}
      <div ref={surfaceRef} className="absolute inset-0 z-5 touch-none" />

      <AnimatePresence>
        {showChrome && (state.phase === 'initializing' || state.phase === 'scanning') && (
          <ARPlacementReticle key="scan" mode="scanning" />
        )}
      </AnimatePresence>

      {showChrome && (
        <>
          <motion.header
            className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-3"
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          >
            <button
              type="button"
              onClick={onExit}
              className="glass-strong pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg transition active:scale-90"
              aria-label="Back to collection"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="glass-strong pointer-events-auto flex min-w-0 flex-col items-center rounded-lg px-4 py-1.5">
              <span className="max-w-[46vw] truncate font-display text-sm font-semibold">{current.name}</span>
              <ARTrackingIndicator state={state} />
            </div>
            <button
              type="button"
              onClick={() => setSelectorOpen(true)}
              className="glass-strong pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg transition active:scale-90"
              aria-label="Replace product"
            >
              <Repeat2 className="h-5 w-5" />
            </button>
          </motion.header>

          <ARInstructions state={state} />
          <ARTapToPlace show={state.phase === 'surface-found'} />
          <ARPerformanceToast show={state.lowPerformance} />

          <ARControls placed={placed} canRotate={current.placement !== 'wall'} onRotate={(d) => session?.rotate(d)} onReset={() => session?.resetPlacement()} onRetrack={() => session?.retrack()} />
          <ARScaleChip scale={state.scale} active={state.grabbing} />
        </>
      )}

      <AnimatePresence>{booting && <ARLoadingScreen key="loading" state={state} />}</AnimatePresence>

      <AnimatePresence>
        {awaitingTap && (
          <motion.div
            key="start"
            className="ambient-bg absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 px-8 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div>
              <h2 className="font-display text-xl font-semibold">Ready for AR</h2>
              <p className="mt-1 text-sm text-white/55">Tap below to open the camera and see {current.name} in your room.</p>
            </div>
            <button
              type="button"
              onClick={() => void session?.startWebXR(true)}
              className="brand-gradient flex h-12 items-center gap-2 rounded-lg px-6 text-[15px] font-semibold transition active:scale-95"
            >
              <Camera className="h-5 w-5" />
              Start AR
            </button>
            <button type="button" onClick={onExit} className="text-sm text-white/50">
              Back to collection
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state.error && (
          <ARErrorScreen
            key="error"
            error={state.error}
            onRetry={retry}
            onBack={onExit}
            onPreview3D={() => setPreviewOpen(true)}
            onChooseAnother={() => {
              session?.retry()
              setSelectorOpen(true)
            }}
          />
        )}
      </AnimatePresence>

      <ARProductSelector
        open={selectorOpen}
        currentId={current.id}
        onSelect={replace}
        onClose={() => setSelectorOpen(false)}
      />

      <ProductPreview3D product={previewOpen ? current : null} onClose={() => setPreviewOpen(false)} />
    </motion.div>
  )
}
