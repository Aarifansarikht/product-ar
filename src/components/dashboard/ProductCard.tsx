import { motion } from 'framer-motion'
import { Box, Rotate3d, ScanLine } from 'lucide-react'
import type { Product } from '../../types/product'
import { formatDimensions } from '../../config/products'
import { prefetchModel } from '../../services/ar/prefetch'

interface ProductCardProps {
  product: Product
  index: number
  onViewInAR: (product: Product) => void
  onPreview3D: (product: Product) => void
}

const placementLabel: Record<Product['placement'], string> = {
  floor: 'Floor',
  tabletop: 'Tabletop',
  wall: 'Wall',
}

/** Hover lift only for real hover devices; on touch screens it would just add work while scrolling. */
const HOVER_LIFT =
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches ? { y: -4 } : undefined

export function ProductCard({ product, index, onViewInAR, onPreview3D }: ProductCardProps) {
  return (
    <motion.article
      className="glass-card group relative flex flex-col overflow-hidden rounded-xl p-1.5 sm:p-2"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 * index, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      whileHover={HOVER_LIFT}
      whileTap={{ scale: 0.985 }}
      onPointerDown={() => prefetchModel(product.modelPath)}
    >
      {/* Accent glow on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 hidden h-48 w-48 -translate-x-1/2 rounded-full opacity-0 blur-3xl [@media(hover:hover)]:block transition-opacity duration-500 group-hover:opacity-40"
        style={{ background: product.accent }}
      />

      {/* Studio stage — product photography is shot on white */}
      <button
        type="button"
        onClick={() => onViewInAR(product)}
        className="relative block aspect-square w-full overflow-hidden rounded-lg bg-gradient-to-b from-white to-[#e9edf3] isolate"
        aria-label={`View ${product.name} in AR`}
      >
        <img
          src={product.thumbnail}
          alt={product.name}
          loading={index < 4 ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain p-3 mix-blend-multiply transition-transform duration-700 ease-[var(--ease-premium)] group-hover:scale-[1.06] sm:p-5"
        />
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-ink-950/75 px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-white/90 uppercase backdrop-blur-md sm:text-[10px]">
          <ScanLine className="h-2.5 w-2.5" strokeWidth={2.4} />
          {placementLabel[product.placement]}
        </span>
      </button>
      {/* 3D preview lives on the photo so "View in AR" gets the full card width. */}
      <button
        type="button"
        onClick={() => onPreview3D(product)}
        className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md bg-ink-950/75 text-white/90 backdrop-blur-md transition hover:bg-ink-950/90 active:scale-90 sm:top-3.5 sm:right-3.5"
        aria-label={`Preview ${product.name} in 3D`}
        title="3D preview"
      >
        <Rotate3d className="h-4 w-4" />
      </button>

      <div className="flex flex-1 flex-col px-1.5 pt-2.5 pb-1 sm:px-2 sm:pt-3.5">
        <p className="text-[10px] font-medium tracking-[0.14em] text-brand-200/70 uppercase">{product.category}</p>
        <h3 className="mt-0.5 font-display text-[15px] leading-tight font-semibold tracking-tight sm:text-lg">{product.name}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/55 sm:text-sm">{product.description}</p>
        <p className="mt-1.5 mb-3 text-[10px] text-white/40 tabular-nums sm:text-[11px]">{formatDimensions(product.dimensions)}</p>

        <button
          type="button"
          onClick={() => onViewInAR(product)}
          className="brand-gradient mt-auto flex h-10 w-full items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold whitespace-nowrap shadow-[0_8px_24px_-12px_rgb(41_197_246/0.7)] transition-[filter,transform] hover:brightness-110 active:scale-[0.97] sm:text-sm"
        >
          <Box className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          View in AR
        </button>
      </div>
    </motion.article>
  )
}
