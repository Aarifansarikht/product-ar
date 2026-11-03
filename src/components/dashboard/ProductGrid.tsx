import type { Product } from '../../types/product'
import { ProductCard } from './ProductCard'

interface ProductGridProps {
  products: Product[]
  onViewInAR: (product: Product) => void
  onPreview3D: (product: Product) => void
}

export function ProductGrid({ products, onViewInAR, onPreview3D }: ProductGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          index={index}
          onViewInAR={onViewInAR}
          onPreview3D={onPreview3D}
        />
      ))}
    </div>
  )
}
