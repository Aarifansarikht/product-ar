import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

interface BottomSheetProps {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

/** Glass bottom sheet on mobile, centered panel on wider screens. Drag down to dismiss. */
export function BottomSheet({ open, title, subtitle, onClose, children }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="absolute inset-0 bg-ink-950/55 backdrop-blur-[2px]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="glass-strong safe-bottom relative w-full max-w-lg rounded-t-xl px-5 pt-3 sm:rounded-xl sm:pb-6"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => (info.offset.y > 90 || info.velocity.y > 600) && onClose()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25 sm:hidden" />
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-semibold">{title}</h2>
                {subtitle && <p className="mt-0.5 text-sm text-white/55">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/75"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
