import { motion } from 'framer-motion'
import { Smartphone } from 'lucide-react'

/**
 * 2D screen-space guide shown while scanning. Once a surface is found, the 3D reticle
 * (rendered in the AR scene by `PlacementReticle`) takes over and sits on the real surface.
 */
export function ARPlacementReticle({ mode }: { mode: 'scanning' | 'surface-found' }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      {mode === 'scanning' ? (
        <motion.div
          className="flex flex-col items-center"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
        >
          <div className="relative h-36 w-36">
            {/* Corner brackets */}
            {['top-0 left-0 border-t-2 border-l-2 rounded-tl-md', 'top-0 right-0 border-t-2 border-r-2 rounded-tr-md', 'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-md', 'bottom-0 right-0 border-r-2 border-b-2 rounded-br-md'].map(
              (cls) => (
                <span key={cls} className={`absolute h-7 w-7 border-white/80 ${cls}`} />
              ),
            )}
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              animate={{ x: [-22, 22, -22], rotate: [-8, 8, -8] }}
              transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}
            >
              <Smartphone className="h-10 w-10 text-white/85 drop-shadow-lg" strokeWidth={1.6} />
            </motion.div>
          </div>
        </motion.div>
      ) : (
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-white/80"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
    </div>
  )
}
