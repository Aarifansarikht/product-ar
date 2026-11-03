/** Which real-world surfaces a product is designed to sit on. */
export type PlacementType = 'floor' | 'tabletop' | 'wall'

/** How the model's bounding box is fitted to its real-world size. */
export type FitAxis = 'height' | 'width' | 'depth' | 'longest'

/** Real-world dimensions in meters (width = X, height = Y, depth = Z). */
export interface Dimensions {
  width: number
  height: number
  depth: number
}

export interface ProductRotationSettings {
  /** Degrees applied per press of the rotate buttons. */
  step: number
  /** Extra yaw (degrees) so the product's "front" faces the viewer when placed. */
  initialYaw: number
}

export interface ProductScaleSettings {
  /** Whether pinch-to-scale is offered. True-to-size furniture keeps this off by default. */
  allowScale: boolean
  min: number
  max: number
}

export interface Product {
  id: string
  name: string
  category: string
  description: string
  thumbnail: string
  modelPath: string
  /** Nominal real-world size, used for the spec label and for normalizing the model. */
  dimensions: Dimensions
  /** Which dimension of `dimensions` the model's bounding box is fitted to (proportions are preserved). */
  fitAxis: FitAxis
  /** Yaw (degrees) applied to the source asset so its front faces +Z before normalization. */
  modelYaw?: number
  /** Multiplier applied after real-world normalization (1 = true to size). */
  defaultScale: number
  placement: PlacementType
  rotation: ProductRotationSettings
  scale: ProductScaleSettings
  /** Accent used for the card glow. */
  accent: string
}
