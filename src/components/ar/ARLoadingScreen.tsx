import { motion } from 'framer-motion'
import { Camera, Check, Cpu, Package } from 'lucide-react'
import type { ARState } from '../../services/ar/arSessionManager'

type StepStatus = 'pending' | 'active' | 'done'

/** Full-screen boot screen shown until the camera feed is live. */
export function ARLoadingScreen({ state }: { state: ARState }) {
  const engineDone = state.phase !== 'loading-engine'
  const cameraDone = engineDone && state.phase !== 'requesting-camera'
  const modelDone = !state.modelLoading && state.modelProgress >= 1

  const steps: { icon: typeof Cpu; label: string; detail: string; status: StepStatus }[] = [
    {
      icon: Cpu,
      label: 'AR engine',
      detail: engineDone ? 'World tracking ready' : 'Loading world tracking…',
      status: engineDone ? 'done' : 'active',
    },
    {
      icon: Camera,
      label: 'Camera',
      detail: cameraDone ? 'Camera connected' : engineDone ? 'Allow camera access when prompted' : 'Waiting',
      status: cameraDone ? 'done' : engineDone ? 'active' : 'pending',
    },
    {
      icon: Package,
      label: state.product?.name ?? 'Product',
      detail: modelDone ? '3D model ready' : `Loading 3D model… ${Math.round(state.modelProgress * 100)}%`,
      status: modelDone ? 'done' : 'active',
    },
  ]

  return (
    <motion.div
      className="ambient-bg absolute inset-0 z-30 flex items-center justify-center px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-5 h-16 w-16">
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-brand-400/25 border-t-brand-400"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
            />
            <span className="absolute inset-3 rounded-full bg-brand-400/15 blur-md" />
          </div>
          <h2 className="font-display text-xl font-semibold">Preparing your AR view</h2>
          <p className="mt-1 text-sm text-white/55">This only takes a moment.</p>
        </div>

        <ul className="space-y-2.5">
          {steps.map(({ icon: Icon, label, detail, status }) => (
            <li
              key={label}
              className={`glass flex items-center gap-3 rounded-lg p-3.5 transition-opacity ${status === 'pending' ? 'opacity-45' : ''}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${status === 'done' ? 'brand-gradient' : 'bg-white/8'}`}
              >
                {status === 'done' ? <Check className="h-4 w-4" strokeWidth={2.6} /> : <Icon className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="truncate text-xs text-white/50">{detail}</p>
              </div>
              {status === 'active' && (
                <motion.span
                  className="h-2 w-2 rounded-full bg-brand-400"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  )
}
