import { useEffect, useState } from 'react'
import type { Product } from '../types/product'
import { modelLibrary, type LoadedModel } from '../services/models/modelLibrary'

export interface ProductLoaderState {
  model: LoadedModel | null
  progress: number
  error: Error | null
}

/** Loads a product's normalized model through the shared cache, exposing progress and errors. */
export function useProductLoader(product: Product | null, attempt = 0): ProductLoaderState {
  const [state, setState] = useState<ProductLoaderState>({ model: null, progress: 0, error: null })

  useEffect(() => {
    if (!product) return
    let active = true
    setState({ model: null, progress: 0, error: null })
    modelLibrary
      .load(product, (progress) => active && setState((s) => ({ ...s, progress })))
      .then((model) => active && setState({ model, progress: 1, error: null }))
      .catch((error: Error) => active && setState({ model: null, progress: 0, error }))
    return () => {
      active = false
    }
  }, [product, attempt])

  return state
}
