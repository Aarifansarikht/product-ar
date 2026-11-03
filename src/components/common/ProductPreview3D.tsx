import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Box, X } from 'lucide-react'
import type { Product } from '../../types/product'
import { useProductLoader } from '../../hooks/useProductLoader'
import { formatDimensions } from '../../config/products'

interface ProductPreview3DProps {
  product: Product | null
  onClose: () => void
  /** Hidden when AR isn't available on this device. */
  onViewInAR?: (product: Product) => void
}

/**
 * Interactive 3D (non-AR) product preview. This is a plain orbit viewer — it is offered as a
 * preview and as the fallback on devices without world-tracking support, never labelled as AR.
 */
export function ProductPreview3D({ product, onClose, onViewInAR }: ProductPreview3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const { model, progress, error } = useProductLoader(product, attempt)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !model) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.NeutralToneMapping
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const env = pmrem.fromScene(room, 0.04).texture
    room.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    pmrem.dispose()
    scene.environment = env
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(2, 4, 3)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 0.8), key)

    const { size, root } = model
    const radius = Math.max(size.x, size.y, size.z)
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.9, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    )
    // The cached model may be shown elsewhere later; borrow it and give it back on cleanup.
    root.position.set(0, 0, 0)
    root.rotation.set(0, 0, 0)
    root.scale.setScalar(1)
    scene.add(root, ground)

    const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 50)
    camera.position.set(radius * 1.4, radius * 0.9, radius * 2)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, size.y * 0.45, 0)
    controls.enableDamping = true
    controls.autoRotate = true
    controls.autoRotateSpeed = 1.2
    controls.minDistance = radius * 0.8
    controls.maxDistance = radius * 5
    controls.maxPolarAngle = Math.PI * 0.49
    controls.addEventListener('start', () => (controls.autoRotate = false))

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    renderer.setAnimationLoop(() => {
      controls.update()
      renderer.render(scene, camera)
    })

    return () => {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      controls.dispose()
      root.removeFromParent()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      env.dispose()
      key.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [model])

  return (
    <AnimatePresence>
      {product && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="glass-strong safe-bottom relative flex h-[82dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl sm:h-[78vh] sm:rounded-xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
          >
            <div className="flex items-start justify-between gap-4 p-5 pb-0">
              <div>
                <p className="text-[11px] tracking-[0.25em] text-brand-200/70 uppercase">3D Preview</p>
                <h2 className="font-display text-xl font-semibold">{product.name}</h2>
                <p className="mt-0.5 text-xs text-white/50">{formatDimensions(product.dimensions)}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="glass flex h-10 w-10 items-center justify-center rounded-lg"
                aria-label="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={mountRef} className="relative min-h-0 flex-1 touch-none">
              {!model && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
                    <div className="brand-gradient h-full transition-[width]" style={{ width: `${Math.max(progress, 0.06) * 100}%` }} />
                  </div>
                  <p className="text-xs text-white/50">Loading model… {Math.round(progress * 100)}%</p>
                </div>
              )}
              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                  <p className="text-sm text-white/70">This 3D model could not be loaded.</p>
                  <button type="button" onClick={() => setAttempt((n) => n + 1)} className="glass rounded-lg px-4 py-2 text-sm">
                    Try again
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 p-5 pt-3">
              <p className="flex-1 text-xs text-white/45">Drag to orbit · pinch or scroll to zoom</p>
              {onViewInAR && (
                <button
                  type="button"
                  onClick={() => onViewInAR(product)}
                  className="brand-gradient flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-semibold"
                >
                  <Box className="h-4 w-4" />
                  View in AR
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
