import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { Product } from '../../types/product'
import { disposeObject, ensureVertexNormals, normalizeModel, type NormalizedModel } from '../../utils/modelUtils'

export interface LoadedModel extends NormalizedModel {
  productId: string
}

export type ProgressListener = (fraction: number) => void

export class ModelLoadError extends Error {
  constructor(public readonly productId: string, cause: unknown) {
    super(`Could not load the 3D model for "${productId}".`)
    this.name = 'ModelLoadError'
    this.cause = cause
  }
}

/** Keeps the most recently used models parsed in memory so swapping products is instant. */
const MAX_CACHED_MODELS = 3

/**
 * Loads, normalizes and caches product models. Each GLB is fetched and parsed at most once
 * while cached; evicted or cleared models have their GPU resources disposed.
 */
class ModelLibrary {
  private readonly loader: GLTFLoader
  private readonly cache = new Map<string, Promise<LoadedModel>>()
  private readonly progress = new Map<string, Set<ProgressListener>>()

  constructor() {
    this.loader = new GLTFLoader()
    // The BMX asset is EXT_meshopt_compression encoded.
    this.loader.setMeshoptDecoder(MeshoptDecoder)
  }

  load(product: Product, onProgress?: ProgressListener): Promise<LoadedModel> {
    if (onProgress) this.listeners(product.id).add(onProgress)

    const cached = this.cache.get(product.id)
    if (cached) {
      // Refresh LRU position.
      this.cache.delete(product.id)
      this.cache.set(product.id, cached)
      cached.then(() => onProgress?.(1)).catch(() => undefined)
      return cached
    }

    const promise = this.loader
      .loadAsync(product.modelPath, (event) => {
        if (!event.total) return
        const fraction = event.loaded / event.total
        this.progress.get(product.id)?.forEach((fn) => fn(fraction))
      })
      .then((gltf) => {
        ensureVertexNormals(gltf.scene)
        const normalized = normalizeModel(gltf.scene, product.dimensions, product.fitAxis, product.modelYaw)
        normalized.root.name = `product:${product.id}`
        this.progress.get(product.id)?.forEach((fn) => fn(1))
        return { ...normalized, productId: product.id }
      })
      .catch((err) => {
        this.cache.delete(product.id)
        throw new ModelLoadError(product.id, err)
      })
      .finally(() => this.progress.delete(product.id))

    this.cache.set(product.id, promise)
    this.evict(product.id)
    return promise
  }

  /** Start fetching in the background (e.g. while the AR engine boots). */
  preload(product: Product) {
    this.load(product).catch(() => undefined)
  }

  /** Call after removing a model from a scene; disposes it if it was evicted meanwhile. */
  detached(model: LoadedModel) {
    if (model.root.userData.evicted) disposeObject(model.root)
  }

  /** Disposes every cached model except `keepId`. */
  clear(keepId?: string) {
    for (const [id, promise] of [...this.cache]) {
      if (id === keepId) continue
      this.cache.delete(id)
      promise.then((m) => disposeObject(m.root)).catch(() => undefined)
    }
  }

  private evict(activeId: string) {
    while (this.cache.size > MAX_CACHED_MODELS) {
      const oldest = [...this.cache.keys()].find((id) => id !== activeId)
      if (!oldest) return
      const promise = this.cache.get(oldest)!
      this.cache.delete(oldest)
      promise
        .then((m) => {
          // A model still attached to a live scene is disposed by its owner once detached.
          if (m.root.parent) m.root.userData.evicted = true
          else disposeObject(m.root)
        })
        .catch(() => undefined)
    }
  }

  private listeners(id: string) {
    let set = this.progress.get(id)
    if (!set) this.progress.set(id, (set = new Set()))
    return set
  }
}

export const modelLibrary = new ModelLibrary()
