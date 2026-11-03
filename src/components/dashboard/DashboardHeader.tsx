import { useState } from 'react'
import { motion } from 'framer-motion'
import { Hand, Info, Move3d, ScanLine, Smartphone } from 'lucide-react'
import { BrandLogo } from '../common/BrandLogo'
import { BottomSheet } from '../common/BottomSheet'

const STEPS = [
  { icon: Smartphone, title: 'Pick a product', text: 'Tap “View in AR” and allow camera access.' },
  { icon: ScanLine, title: 'Scan your space', text: 'Move your phone slowly so the floor or table is detected.' },
  { icon: Hand, title: 'Tap to place', text: 'Products appear at their real-world size.' },
  { icon: Move3d, title: 'Make it yours', text: 'Drag to move, twist or use the controls to rotate.' },
]

export function DashboardHeader() {
  const [infoOpen, setInfoOpen] = useState(false)

  return (
    <>
      <motion.header
        className="safe-top flex items-center justify-between gap-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center gap-3">
          <div className="glass flex h-12 w-12 items-center justify-center rounded-lg">
            <BrandLogo className="h-8 w-8" />
          </div>
          <div className="leading-tight">
            <p className="font-display text-[15px] font-semibold tracking-tight">AR Experience</p>
            <p className="text-xs text-white/50">Bay81 Studio · View in your room</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          className="glass flex h-11 w-11 items-center justify-center rounded-lg text-white/75 transition hover:text-white active:scale-95"
          aria-label="How it works"
        >
          <Info className="h-5 w-5" />
        </button>
      </motion.header>

      <BottomSheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="How it works"
        subtitle="Works on iPhone (Safari) and Android (Chrome)."
      >
        <ol className="space-y-2.5">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="glass flex items-start gap-3 rounded-lg p-3.5">
              <span className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="text-sm font-semibold">
                  {i + 1}. {title}
                </p>
                <p className="mt-0.5 text-sm text-white/60">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-center text-[11px] text-white/35">World tracking powered by the 8th Wall engine.</p>
      </BottomSheet>
    </>
  )
}
