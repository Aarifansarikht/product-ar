import * as THREE from 'three'

const OUTLINE_COLOR = new THREE.Color('#38bdf8')
/** Outline thickness as a fraction of view depth, so it looks equally thick at any distance. */
const OUTLINE_WIDTH = 0.0045

/**
 * Blue "selected" outline drawn around the product while it is touched or dragged.
 *
 * Technique: an inverted hull — each mesh gets a sibling that reuses its geometry, rendered
 * back-faces only and pushed out along view-space normals. The original front faces cover the
 * interior, leaving a clean silhouette. No extra geometry memory and no post-processing pass.
 */
export class SelectionOutline {
  private readonly material: THREE.ShaderMaterial
  private readonly hulls: THREE.Mesh[] = []
  private opacity = 0
  private targetOpacity = 0

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: OUTLINE_COLOR },
        width: { value: OUTLINE_WIDTH },
        opacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float width;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vec3 viewNormal = normalize(normalMatrix * normal);
          mvPosition.xyz += viewNormal * width * -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        void main() {
          gl_FragColor = vec4(color, opacity);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    })
  }

  /** Builds hulls for a model. Call `detach` before the model leaves the scene. */
  attach(modelRoot: THREE.Object3D) {
    this.detach()
    const meshes: THREE.Mesh[] = []
    modelRoot.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh && mesh.geometry.getAttribute('normal')) meshes.push(mesh)
    })
    for (const mesh of meshes) {
      const hull = new THREE.Mesh(mesh.geometry, this.material)
      hull.name = 'selection-outline'
      hull.raycast = () => undefined
      hull.renderOrder = 2
      hull.visible = this.opacity > 0.01
      mesh.add(hull)
      this.hulls.push(hull)
    }
  }

  /** Removes the hulls (the shared geometry belongs to the model and is left intact). */
  detach() {
    for (const hull of this.hulls) hull.removeFromParent()
    this.hulls.length = 0
  }

  setActive(active: boolean) {
    this.targetOpacity = active ? 0.95 : 0
  }

  update(dt: number) {
    if (this.opacity === this.targetOpacity) return
    // Appear instantly, fade out gently.
    const rate = this.targetOpacity > this.opacity ? 40 : 6
    this.opacity += (this.targetOpacity - this.opacity) * (1 - Math.exp(-dt * rate))
    if (Math.abs(this.opacity - this.targetOpacity) < 0.01) this.opacity = this.targetOpacity
    this.material.uniforms.opacity.value = this.opacity
    const visible = this.opacity > 0.01
    for (const hull of this.hulls) hull.visible = visible
  }

  dispose() {
    this.detach()
    this.material.dispose()
  }
}
