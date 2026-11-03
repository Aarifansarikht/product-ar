import { Check } from 'lucide-react'
import type { Product } from '../../types/product'
import { PRODUCTS, formatDimensions } from '../../config/products'
import { BottomSheet } from '../common/BottomSheet'

interface ARProductSelectorProps {
  open: boolean
  currentId: string | undefined
  onSelect: (product: Product) => void
  onClose: () => void
}

/** Replace-object sheet. Selecting swaps the model in place; the camera session keeps running. */
export function ARProductSelector({ open, currentId, onSelect, onClose }: ARProductSelectorProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Replace object" subtitle="Your AR session stays active.">
      <ul className="grid grid-cols-2 gap-2.5">
        {PRODUCTS.map((product) => {
          const active = product.id === currentId
          return (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onSelect(product)}
                className={`relative flex w-full flex-col overflow-hidden rounded-lg text-left transition active:scale-[0.97] ${active ? 'ring-2 ring-brand-400' : 'ring-1 ring-white/10'}`}
                aria-pressed={active}
              >
                <span className="relative block aspect-[4/3] bg-gradient-to-b from-white to-[#e9edf3]">
                  <img
                    src={product.thumbnail}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain p-3 mix-blend-multiply"
                    draggable={false}
                  />
                  {active && (
                    <span className="brand-gradient absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="block bg-white/5 px-3 py-2.5">
                  <span className="block text-sm font-semibold">{product.name}</span>
                  <span className="block text-[11px] text-white/45">{formatDimensions(product.dimensions)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </BottomSheet>
  )
}
