import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { BrandLogo } from '../common/BrandLogo'

const SPLASH_DURATION_MS = 2300

/** Short branded intro. Advances on its own; a tap skips it. */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, SPLASH_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [onDone])

  return (
    <motion.div
      className="ambient-bg grain fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04, filter: 'blur(8px)' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      onClick={onDone}
    >
      {/* Soft ambient light orbs */}
      <motion.div
        aria-hidden
        className="absolute h-[28rem] w-[28rem] rounded-full bg-brand-400/20 blur-3xl"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.6, ease: 'easeOut' }}
      />

      <motion.div
        className="glass relative flex h-40 w-40 items-center justify-center rounded-2xl sm:h-44 sm:w-44"
        initial={{ opacity: 0, y: 18, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <BrandLogo className="h-24 w-24 sm:h-28 sm:w-28" />
        {/* Light sweep across the glass */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          <motion.span
            className="absolute -inset-y-4 w-12 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            initial={{ x: -80 }}
            animate={{ x: 240 }}
            transition={{ delay: 0.7, duration: 1.1, ease: 'easeInOut' }}
          />
        </motion.span>
      </motion.div>

      <motion.div
        className="relative mt-8 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="font-display text-xs tracking-[0.5em] text-brand-200/80 uppercase">Bay81 Studio</p>
        <h1 className="text-gradient mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          AR Experience
        </h1>
      </motion.div>

      <div className="relative mt-10 h-[3px] w-40 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="brand-gradient h-full rounded-full"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: SPLASH_DURATION_MS / 1000 - 0.3, ease: [0.65, 0, 0.35, 1] }}
        />
      </div>
    </motion.div>
  )
}
