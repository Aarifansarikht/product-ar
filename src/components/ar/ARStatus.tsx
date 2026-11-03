import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Hand, Gauge, ScanLine, TriangleAlert } from 'lucide-react'
import type { ARState } from '../../services/ar/arSessionManager'
import type { PlacementType } from '../../types/product'

const PLACED_INSTRUCTION_MS = 4500

const SURFACE_COPY: Record<PlacementType, { noun: string; pointAt: string; stillLooking: string }> = {
  floor: {
    noun: 'floor',
    pointAt: 'Point at the floor.',
    stillLooking: 'Still looking — aim at a well-lit floor with some texture.',
  },
  tabletop: {
    noun: 'table',
    pointAt: 'Point at a table or countertop.',
    stillLooking: 'Still looking — aim at a well-lit table with some texture.',
  },
  wall: {
    noun: 'wall',
    pointAt: 'Aim at a spot with some detail — a frame, switch or texture.',
    stillLooking: 'Plain walls are hard to track — aim near a frame, outlet or door edge.',
  },
}

/** Contextual instruction for the current phase, or null to hide it. */
function instructionFor(state: ARState, placedHintVisible: boolean): { text: string; sub?: string; tone: 'info' | 'warn' } | null {
  if (state.tracking === 'lost') {
    return { text: 'Tracking lost. Move your camera slowly to scan the room again.', tone: 'warn' }
  }
  const placement = state.product?.placement ?? 'floor'
  const surface = SURFACE_COPY[placement]
  switch (state.phase) {
    case 'initializing':
    case 'scanning':
      return {
        text:
          placement === 'wall'
            ? 'Point your camera at a wall and move slowly.'
            : 'Move your camera slowly to scan your surroundings.',
        sub: state.noSurfaceHint ? surface.stillLooking : surface.pointAt,
        tone: 'info',
      }
    case 'surface-found':
      // The centered "Tap to place" pill covers this; only explain a surface change.
      return state.needsReplacement
        ? { text: `${state.product?.name} goes on a ${surface.noun}.`, sub: 'Tap the surface to place it.', tone: 'info' }
        : null
    case 'placed':
      return placedHintVisible && !state.grabbing
        ? {
            text: 'Touch and drag the object to move it.',
            sub: placement === 'wall' ? 'Slides along the wall · pinch to resize.' : 'Twist to rotate · pinch to resize.',
            tone: 'info',
          }
        : null
    default:
      return null
  }
}

export function ARInstructions({ state }: { state: ARState }) {
  const [placedHintVisible, setPlacedHintVisible] = useState(true)

  useEffect(() => {
    if (state.phase !== 'placed') {
      setPlacedHintVisible(true)
      return
    }
    const t = window.setTimeout(() => setPlacedHintVisible(false), PLACED_INSTRUCTION_MS)
    return () => window.clearTimeout(t)
  }, [state.phase])

  const instruction = instructionFor(state, placedHintVisible)
  const Icon = instruction?.tone === 'warn' ? TriangleAlert : state.phase === 'surface-found' || state.phase === 'placed' ? Hand : ScanLine

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(max(env(safe-area-inset-top),0.75rem)+4.5rem)] z-20 flex justify-center px-4">
      <AnimatePresence mode="wait">
        {instruction && (
          <motion.div
            key={instruction.text + (instruction.sub ?? '')}
            className={`glass-strong flex max-w-sm items-start gap-3 rounded-lg px-4 py-3 ${instruction.tone === 'warn' ? 'border-amber-300/40' : ''}`}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            role="status"
            aria-live="polite"
          >
            <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${instruction.tone === 'warn' ? 'text-amber-300' : 'text-brand-300'}`} />
            <div>
              <p className="text-sm leading-snug font-medium">{instruction.text}</p>
              {instruction.sub && <p className="mt-0.5 text-xs text-white/55">{instruction.sub}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** "Tap to place" pill floating just above the reticle, as in native AR viewers. */
export function ARTapToPlace({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-[calc(50%-5.5rem)] z-20 flex justify-center"
          initial={{ opacity: 0, y: 6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.95 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="rounded-lg bg-white/92 px-5 py-2.5 text-[15px] font-semibold text-ink-900 shadow-[0_8px_30px_-8px_rgb(0_0_0/0.5)]">
            Tap to place
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Size readout shown while pinching (100% = true size). */
export function ARScaleChip({ scale, active }: { scale: number; active: boolean }) {
  const [visible, setVisible] = useState(false)
  const [lastScale, setLastScale] = useState(scale)
  if (scale !== lastScale) {
    setLastScale(scale)
    if (active) setVisible(true)
  }
  useEffect(() => {
    if (!visible || active) return
    const t = window.setTimeout(() => setVisible(false), 900)
    return () => window.clearTimeout(t)
  }, [visible, active, scale])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="glass-strong pointer-events-none absolute top-[calc(max(env(safe-area-inset-top),0.75rem)+4.5rem)] left-1/2 z-20 -translate-x-1/2 rounded-lg px-3 py-1.5 text-sm font-semibold tabular-nums"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
        >
          {Math.round(scale * 100)}%{Math.round(scale * 100) === 100 ? ' · True size' : ''}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Small status chip: tracking quality and model loading progress. */
export function ARTrackingIndicator({ state }: { state: ARState }) {
  const { tracking, modelLoading, modelProgress } = state
  const label = modelLoading
    ? `Loading ${Math.round(modelProgress * 100)}%`
    : tracking === 'normal'
      ? 'Tracking'
      : tracking === 'lost'
        ? 'Limited'
        : 'Calibrating'
  const color = modelLoading ? 'bg-brand-300' : tracking === 'normal' ? 'bg-emerald-400' : tracking === 'lost' ? 'bg-amber-400' : 'bg-white/70'

  return (
    <div className="glass-strong flex items-center gap-1.5 rounded-lg px-2.5 py-1">
      <span className="relative flex h-2 w-2">
        {tracking !== 'normal' || modelLoading ? (
          <span className={`absolute inset-0 animate-ping rounded-full opacity-60 ${color}`} />
        ) : null}
        <span className={`relative h-2 w-2 rounded-full ${color}`} />
      </span>
      <span className="text-[10px] font-medium tracking-wide text-white/80 tabular-nums">{label}</span>
    </div>
  )
}

export function ARPerformanceToast({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!show) return
    setVisible(true)
    const t = window.setTimeout(() => setVisible(false), 4000)
    return () => window.clearTimeout(t)
  }, [show])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="glass-strong pointer-events-none absolute bottom-32 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg px-3.5 py-2 text-xs"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
        >
          <Gauge className="h-3.5 w-3.5 text-amber-300" />
          Performance mode on for smoother tracking
        </motion.div>
      )}
    </AnimatePresence>
  )
}
