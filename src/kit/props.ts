import * as THREE from 'three'
import { rng } from '../core/math'

/*
 * Game props, real size (1 unit = 1 yard): scale them up for close-ups.
 *
 *   createFootball()   pebbled leather, pointed tips, white laces; long axis
 *                      along +x, laces on top (+y). 11 in long = 0.306 yd.
 *   createTee()        a kicking tee (orange, 1 in lift) under a standing ball
 *
 * Lit materials: they take the world's key/hemisphere light and the stadium
 * reflections (scene.environment).
 */

let pebble: THREE.Texture | null = null
/** A small tileable pebble-grain normal map (256², built once). */
function pebbleNormal() {
  if (pebble) return pebble
  const n = 256
  const h = new Float32Array(n * n)
  const rand = rng(11)
  // scatter bumps
  for (let k = 0; k < 2600; k++) {
    const cx = rand() * n
    const cy = rand() * n
    const r = 2 + rand() * 2.5
    for (let y = -4; y <= 4; y++)
      for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x, y) / r
        if (d > 1) continue
        const ix = (Math.floor(cx + x) + n) % n
        const iy = (Math.floor(cy + y) + n) % n
        h[iy * n + ix] = Math.max(h[iy * n + ix], Math.cos(d * Math.PI * 0.5))
      }
  }
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)]
      const dy = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x]
      const v = new THREE.Vector3(-dx * 1.5, -dy * 1.5, 1).normalize()
      const i = (y * n + x) * 4
      data[i] = (v.x * 0.5 + 0.5) * 255
      data[i + 1] = (v.y * 0.5 + 0.5) * 255
      data[i + 2] = (v.z * 0.5 + 0.5) * 255
      data[i + 3] = 255
    }
  const t = new THREE.DataTexture(data, n, n)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(6, 3)
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  pebble = t
  return t
}

export function createFootball({ detail = 48 }: { detail?: number } = {}) {
  const g = new THREE.Group()
  g.name = 'football'
  const L = 0.153 // half length (yd)
  const R = 0.094 // max radius
  const prof: THREE.Vector2[] = []
  const N = 40
  for (let i = 0; i <= N; i++) {
    const s = -1 + (2 * i) / N
    const r = R * Math.pow(Math.max(0, 1 - s * s), 0.68)
    prof.push(new THREE.Vector2(Math.max(r, 0.0005), s * L))
  }
  const body = new THREE.LatheGeometry(prof, detail)
  body.rotateZ(-Math.PI / 2) // long axis → +x
  const leather = new THREE.MeshStandardMaterial({
    color: '#6a3519',
    roughness: 0.58,
    metalness: 0,
    normalMap: pebbleNormal(),
    normalScale: new THREE.Vector2(0.55, 0.55),
    envMapIntensity: 0.8,
  })
  g.add(new THREE.Mesh(body, leather))
  // laces: a seam strip and eight cross stitches on top
  const white = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.6 })
  const seam = new THREE.Mesh(new THREE.BoxGeometry(L * 1.05, 0.004, 0.012), white)
  seam.position.y = R * 0.985
  g.add(seam)
  const lace = new THREE.BoxGeometry(0.008, 0.007, 0.042)
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(lace, white)
    const x = -L * 0.42 + (i / 7) * L * 0.84
    m.position.set(x, R * Math.pow(Math.max(0, 1 - (x / L) ** 2), 0.68) + 0.002, 0)
    g.add(m)
  }
  return g
}

export function createTee() {
  const g = new THREE.Group()
  const m = new THREE.MeshStandardMaterial({ color: '#ff6a1f', roughness: 0.55, emissive: new THREE.Color('#3a1000') })
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.02, 24), m)
  base.position.y = 0.01
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.03, 20, 1, true), m)
  stem.position.y = 0.035
  g.add(base, stem)
  return g
}
