import { Suspense, lazy, useState } from 'react'
import { motion } from 'framer-motion'
import type { Product } from '../types/product'
import { PRODUCTS } from '../config/products'
import { DashboardHeader } from '../components/dashboard/DashboardHeader'
import { ProductGrid } from '../components/dashboard/ProductGrid'

const ProductPreview3D = lazy(() =>
  import('../components/common/ProductPreview3D').then((m) => ({ default: m.ProductPreview3D })),
)

interface HomePageProps {
  onSelectProduct: (product: Product) => void
}

export function HomePage({ onSelectProduct }: HomePageProps) {
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null)

  return (
    <motion.main
      className="relative min-h-dvh overflow-x-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Background is pinned to the viewport so scrolling never repaints the gradients/grain. */}
      <div aria-hidden className="ambient-bg grain pointer-events-none fixed inset-0 -z-10" />
      <div className="relative mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-10">
        <DashboardHeader />

        <section className="pt-10 pb-8 sm:pt-16 sm:pb-12">
          <motion.h1
            className="text-gradient max-w-2xl font-display text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            Bring Your Space to Life
          </motion.h1>
          <motion.p
            className="mt-4 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            Explore our collection and visualize products in your room with augmented reality.
          </motion.p>
        </section>

        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-sm font-medium tracking-[0.2em] text-white/50 uppercase">The Collection</h2>
          <p className="text-xs text-white/35">{PRODUCTS.length} products · true to scale</p>
        </div>

        <ProductGrid products={PRODUCTS} onViewInAR={onSelectProduct} onPreview3D={setPreviewProduct} />

        <footer className="mt-14 text-center text-xs text-white/30">
          © {new Date().getFullYear()} Bay81 Studio · Best experienced on a mobile device
        </footer>
      </div>

      {previewProduct && (
        <Suspense fallback={null}>
          <ProductPreview3D
            product={previewProduct}
            onClose={() => setPreviewProduct(null)}
            onViewInAR={(p) => {
              setPreviewProduct(null)
              onSelectProduct(p)
            }}
          />
        </Suspense>
      )}
    </motion.main>
  )
}
