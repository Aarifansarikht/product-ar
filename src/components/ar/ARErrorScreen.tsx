import { motion } from 'framer-motion'
import { ArrowLeft, CameraOff, Compass, PackageX, RefreshCw, Rotate3d, ShieldAlert, Smartphone } from 'lucide-react'
import type { ARError } from '../../services/ar/arSessionManager'

interface ARErrorScreenProps {
  error: ARError
  onRetry: () => void
  onBack: () => void
  onPreview3D: () => void
  onChooseAnother: () => void
}

const ICONS: Record<ARError['code'], typeof CameraOff> = {
  'camera-denied': CameraOff,
  'motion-denied': Compass,
  'camera-unavailable': CameraOff,
  'unsupported-device': Smartphone,
  'unsupported-browser': Smartphone,
  'insecure-context': ShieldAlert,
  'sdk-failed': ShieldAlert,
  'model-failed': PackageX,
}

/** Never leave the user on a blank screen: explain the problem and offer a way forward. */
export function ARErrorScreen({ error, onRetry, onBack, onPreview3D, onChooseAnother }: ARErrorScreenProps) {
  const Icon = ICONS[error.code]
  const unsupported = ['unsupported-device', 'unsupported-browser', 'insecure-context'].includes(error.code)
  const isModel = error.code === 'model-failed'

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ink-950/80 px-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="glass-strong w-full max-w-sm rounded-xl p-6 text-center"
        initial={{ y: 20, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-white/8">
          <Icon className="h-6 w-6 text-brand-200" />
        </div>
        <h2 className="font-display text-xl font-semibold">{error.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{error.message}</p>

        <div className="mt-6 space-y-2.5">
          {isModel ? (
            <>
              <button type="button" onClick={onRetry} className="brand-gradient flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold">
                <RefreshCw className="h-4 w-4" /> Try again
              </button>
              <button type="button" onClick={onChooseAnother} className="glass flex h-12 w-full items-center justify-center rounded-lg text-sm">
                Choose another product
              </button>
            </>
          ) : unsupported ? (
            <button type="button" onClick={onPreview3D} className="brand-gradient flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold">
              <Rotate3d className="h-4 w-4" /> Preview in 3D instead
            </button>
          ) : (
            <button type="button" onClick={onRetry} className="brand-gradient flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold">
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          )}
          <button type="button" onClick={onBack} className="glass flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm">
            <ArrowLeft className="h-4 w-4" /> Back to collection
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
