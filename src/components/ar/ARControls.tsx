import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RotateCcw, RotateCw, ScanLine, Undo2 } from 'lucide-react'

interface ARControlsProps {
  placed: boolean
  /** Wall items stay aligned with the wall, so they only get Reset. */
  canRotate: boolean
  onRotate: (direction: 'left' | 'right') => void
  onReset: () => void
  /** Clear the placement and restart tracking to place again somewhere new. */
  onRetrack: () => void
}

function DockButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-12 w-12 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/10 active:scale-90 active:bg-white/15"
    >
      {children}
    </button>
  )
}

/**
 * Minimal floating dock, shown once the product is placed. Moving is done by dragging the
 * product itself (and rotating with a two-finger twist); these are just precise shortcuts.
 */
export function ARControls({ placed, canRotate, onRotate, onReset, onRetrack }: ARControlsProps) {
  return (
    <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3">
      <AnimatePresence>
        {placed && (
          <motion.nav
            className="glass-strong pointer-events-auto flex items-center gap-1 rounded-xl p-1"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            aria-label="AR controls"
          >
            {canRotate && (
              <DockButton label="Rotate left" onClick={() => onRotate('left')}>
                <RotateCcw className="h-5 w-5" />
              </DockButton>
            )}
            <DockButton label="Reset position" onClick={onReset}>
              <Undo2 className="h-5 w-5" />
            </DockButton>
            {canRotate && (
              <DockButton label="Rotate right" onClick={() => onRotate('right')}>
                <RotateCw className="h-5 w-5" />
              </DockButton>
            )}
            <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
            <button
              type="button"
              onClick={onRetrack}
              className="flex h-12 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-white/90 transition hover:bg-white/10 active:scale-95 active:bg-white/15"
            >
              <ScanLine className="h-4.5 w-4.5" />
              Re-track
            </button>
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  )
}
