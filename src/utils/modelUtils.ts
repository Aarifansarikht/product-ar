import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Dimensions, FitAxis } from '../types/product'

export interface NormalizedModel {
  /** Wrapper whose origin is the center of the model's footprint, resting on y = 0. */
  root: THREE.Group
  /** Final real-world size in meters after normalization. */
  size: THREE.Vector3
  /** Uniform scale that was applied to the source asset. */
  appliedScale: number
}

const pickTarget = (dims: Dimensions, axis: FitAxis, size: THREE.Vector3) => {
  switch (axis) {
    case 'height':
      return { target: dims.height, source: size.y }
    case 'width':
      return { target: dims.width, source: size.x }
    case 'depth':
      return { target: dims.depth, source: size.z }
    case 'longest': {
      const longest = Math.max(dims.width, dims.height, dims.depth)
      return { target: longest, source: Math.max(size.x, size.y, size.z) }
    }
  }
}

/**
 * Scales a model uniformly (never distorting its aspect ratio) so the chosen axis of its
 * bounding box matches the real-world dimension, then re-centers it so it sits on the
 * ground plane (y = 0) with its footprint centered on the origin.
 */
export function normalizeModel(
  source: THREE.Object3D,
  dims: Dimensions,
  fitAxis: FitAxis,
  yawDegrees = 0,
): NormalizedModel {
  if (yawDegrees) {
    // Re-orient the asset first so bounds (and the fitted axes) are measured front-facing.
    const oriented = new THREE.Group()
    oriented.rotation.y = THREE.MathUtils.degToRad(yawDegrees)
    oriented.add(source)
    source = oriented
  }
  source.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(source, true)
  const rawSize = box.getSize(new THREE.Vector3())

  const { target, source: measured } = pickTarget(dims, fitAxis, rawSize)
  const appliedScale = measured > 0 ? target / measured : 1

  const root = new THREE.Group()
  root.name = 'normalized-model'
  const pivot = new THREE.Group()
  pivot.scale.setScalar(appliedScale)
  const center = box.getCenter(new THREE.Vector3())
  // Shift so the bottom-center of the bounding box lands on the origin.
  pivot.position.set(-center.x * appliedScale, -box.min.y * appliedScale, -center.z * appliedScale)
  pivot.add(source)
  root.add(pivot)

  return { root, size: rawSize.multiplyScalar(appliedScale), appliedScale }
}

/**
 * Some exported assets (e.g. the chair GLB) ship without vertex normals, which renders as
 * faceted flat shading. Weld duplicate vertices and compute smooth normals for those meshes.
 */
export function ensureVertexNormals(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || mesh.geometry.getAttribute('normal')) return
    const welded = mergeVertices(mesh.geometry, 1e-4)
    welded.computeVertexNormals()
    mesh.geometry.dispose()
    mesh.geometry = welded
  })
}

/** Configures meshes for AR rendering: correct color space, shadows and frustum culling. */
export function prepareForAR(object: THREE.Object3D, maxAnisotropy: number) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = false
    mesh.receiveShadow = false
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const std = material as THREE.MeshStandardMaterial
      if (std.map) std.map.anisotropy = Math.min(4, maxAnisotropy)
      // Imported assets occasionally ship as transparent; opaque rendering avoids sorting artifacts.
      if (std.transparent && std.opacity >= 0.99 && !std.alphaMap) std.transparent = false
      std.needsUpdate = true
    }
  })
}

/** Frees GPU memory held by every geometry, material and texture under `object`. */
export function disposeObject(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>()
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh && !(child as THREE.Points).isPoints && !(child as THREE.Line).isLine) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) continue
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
      material.dispose()
    }
  })
  textures.forEach((t) => t.dispose())
  object.removeFromParent()
}
