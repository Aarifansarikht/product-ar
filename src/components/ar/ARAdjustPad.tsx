import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Move, X } from 'lucide-react'

type Axis = 'x' | 'y'

interface ARAdjustPadProps {
  show: boolean
  placed: boolean
  wall: boolean
  /** Floor/table height correction in metres. */
  surfaceOffset: number
  onNudge: (axis: Axis, direction: 1 | -1) => void
}

const REPEAT_DELAY_MS = 320
const REPEAT_EVERY_MS = 55

/** Arrow that nudges once on press and keeps nudging while held. */
function NudgeButton({ label, disabled, onStep, children }: { label: string; disabled?: boolean; onStep: () => void; children: ReactNode }) {
  const timers = useRef<{ delay?: number; repeat?: number }>({})
  const stop = () => {
    window.clearTimeout(timers.current.delay)
    window.clearInterval(timers.current.repeat)
    timers.current = {}
  }
  useEffect(() => stop, [])

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault()
        onStep()
        timers.current.delay = window.setTimeout(() => {
          timers.current.repeat = window.setInterval(onStep, REPEAT_EVERY_MS)
        }, REPEAT_DELAY_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-white/90 transition active:scale-90 active:bg-white/15 disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  )
}

/**
 * Precise 1 cm adjustment, for when tracking puts the dots or the product a little off:
 * ↑↓ moves along Y (height — the dots before placing, the product after; up/down the wall for
 * art), ←→ moves along X (sideways from the viewer; along the wall for art), once placed.
 */
export function ARAdjustPad({ show, placed, wall, surfaceOffset, onNudge }: ARAdjustPadProps) {
  const [open, setOpen] = useState(false)
  const canY = placed || !wall
  const cm = Math.round(surfaceOffset * 100)
  const hint = !placed
    ? '↑↓ raise / lower the dots'
    : wall
      ? '↑↓ up / down · ←→ along the wall'
      : '↑↓ height · ←→ sideways'

  return (
    // Lower right, above the control dock: clear of the reticle and the "Tap to place" pill.
    <div className="pointer-events-none absolute right-3 bottom-[calc(max(env(safe-area-inset-bottom),0.75rem)+5.25rem)] z-20 flex flex-col items-end gap-2">
      <AnimatePresence initial={false} mode="wait">
        {show && !open && (
          <motion.button
            key="toggle"
            type="button"
            onClick={() => setOpen(true)}
            className="glass-strong pointer-events-auto flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-white/90 transition active:scale-95"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            aria-label="Adjust position"
          >
            <Move className="h-4 w-4" />
            Adjust
          </motion.button>
        )}
        {show && open && (
          <motion.div
            key="pad"
            // Only the pad itself takes touches; the rest of the screen stays free for placing.
            className="pointer-events-none flex flex-col items-end gap-1.5"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="glass-strong pointer-events-auto grid grid-cols-3 gap-0.5 rounded-xl p-1" role="group" aria-label="Adjust position">
              <span />
              <NudgeButton label="Move up" disabled={!canY} onStep={() => onNudge('y', 1)}>
                <ChevronUp className="h-5 w-5" />
              </NudgeButton>
              <span />
              <NudgeButton label="Move left" disabled={!placed} onStep={() => onNudge('x', -1)}>
                <ChevronLeft className="h-5 w-5" />
              </NudgeButton>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close adjust"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-white/60 transition active:scale-90"
              >
                <X className="h-4 w-4" />
              </button>
              <NudgeButton label="Move right" disabled={!placed} onStep={() => onNudge('x', 1)}>
                <ChevronRight className="h-5 w-5" />
              </NudgeButton>
              <span />
              <NudgeButton label="Move down" disabled={!canY} onStep={() => onNudge('y', -1)}>
                <ChevronDown className="h-5 w-5" />
              </NudgeButton>
              <span />
            </div>
            <p className="glass-strong max-w-38 rounded-md px-2 py-1 text-right text-[10px] leading-snug text-white/70 tabular-nums">
              {hint}
              {!wall && cm !== 0 ? ` · floor ${cm > 0 ? '+' : ''}${cm} cm` : ''}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
