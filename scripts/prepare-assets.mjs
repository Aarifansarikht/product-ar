// Copies the studio's source assets (kept untouched in the project root) into
// `public/` with URL-safe names, generates lightweight WebP thumbnails, and
// vendors the 8th Wall engine binary so it is served from our own origin.
import { cp, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = path.join(root, 'public')

const products = [
  { id: 'chair', model: 'Chair/chair GLB.glb', image: 'Chair/Modern Grey Fabric Armchair with Wooden Frame.png' },
  { id: 'sofa', model: 'Sofa/modern_sofa.glb', image: 'Sofa/Elegant Ivory Loveseat with Wooden Legs.png' },
  { id: 'tea-pot', model: 'Tea_pot/cloisonne_tea_pot.glb', image: 'Tea_pot/Ornate Golden Floral Ceramic Teapot.png' },
  { id: 'cycle', model: 'Cycle/bmx_cycle.glb', image: 'Cycle/Glossy Red and Yellow BMX Bicycle.png' },
  { id: 'art', model: 'Art/abstract_geometric_canvas_paintings_low_poly.glb', image: 'Art/Abstract Geometric Mosaic Canvas Print.png' },
]

/** Skip work when the output is newer than its source. */
async function isFresh(src, dest) {
  if (!existsSync(dest)) return false
  const [s, d] = await Promise.all([stat(src), stat(dest)])
  return d.mtimeMs >= s.mtimeMs
}

async function copyIfStale(src, dest) {
  if (await isFresh(src, dest)) return
  await mkdir(path.dirname(dest), { recursive: true })
  await cp(src, dest)
  console.log('  copied', path.relative(root, dest))
}

async function thumbnail(src, dest, width) {
  if (await isFresh(src, dest)) return
  await mkdir(path.dirname(dest), { recursive: true })
  await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(dest)
  console.log('  generated', path.relative(root, dest))
}

console.log('[assets] preparing public assets')
for (const p of products) {
  const dir = path.join(pub, 'products', p.id)
  await copyIfStale(path.join(root, p.model), path.join(dir, 'model.glb'))
  await thumbnail(path.join(root, p.image), path.join(dir, 'thumbnail.webp'), 720)
}
await thumbnail(path.join(root, 'bay81-logo.png'), path.join(pub, 'brand', 'bay81-logo.webp'), 512)
const favicon = path.join(pub, 'brand', 'favicon.png')
if (!(await isFresh(path.join(root, 'bay81-logo.png'), favicon))) {
  await sharp(path.join(root, 'bay81-logo.png')).resize(96, 96, { fit: 'contain', background: '#00000000' }).png().toFile(favicon)
}

const engineSrc = path.join(root, 'node_modules', '@8thwall', 'engine-binary', 'dist')
const engineDest = path.join(pub, 'external', 'xr')
if (!existsSync(engineSrc)) {
  console.warn('[assets] @8thwall/engine-binary is not installed — AR will be unavailable. Run `npm install`.')
} else if (!(await isFresh(path.join(engineSrc, 'xr.js'), path.join(engineDest, 'xr.js')))) {
  await cp(engineSrc, engineDest, { recursive: true })
  console.log('  vendored 8th Wall engine ->', path.relative(root, engineDest))
}
console.log('[assets] done')
