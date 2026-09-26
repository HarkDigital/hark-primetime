import * as THREE from 'three'

/*
 * Frame a set of world points into a screen rectangle (NDC) with a fixed view
 * direction: the camera dollies along the view axis until the points' screen
 * bounds fit the rect, then slides sideways/up (a lens shift, the view stays
 * parallel) until they're centred in it. A few fixed-point iterations handle
 * the perspective. Pure: same inputs, same pose; no allocations.
 */

const Y = new THREE.Vector3(0, 1, 0)
const r = new THREE.Vector3()
const u = new THREE.Vector3()
const cam = new THREE.Vector3()
const rel = new THREE.Vector3()
const b = { x0: 0, x1: 0, y0: 0, y1: 0 }

export interface Rect {
  x0: number
  x1: number
  y0: number
  y1: number
}

function bounds(keys: readonly THREE.Vector3[], dir: THREE.Vector3, t: number, aspect: number) {
  b.x0 = b.y0 = Infinity
  b.x1 = b.y1 = -Infinity
  for (const k of keys) {
    rel.subVectors(k, cam)
    const z = Math.max(1e-3, rel.dot(dir))
    const x = rel.dot(r) / (z * t * aspect)
    const y = rel.dot(u) / (z * t)
    if (x < b.x0) b.x0 = x
    if (x > b.x1) b.x1 = x
    if (y < b.y0) b.y0 = y
    if (y > b.y1) b.y1 = y
  }
  return b
}

/**
 * Writes position/target so `keys` fill `rect`. `anchor` is a point near the
 * middle of the subject (the camera starts `dist0` behind it).
 */
export function fitShot(
  out: { position: THREE.Vector3; target: THREE.Vector3 },
  dir: THREE.Vector3,
  keys: readonly THREE.Vector3[],
  rect: Rect,
  fov: number,
  aspect: number,
  anchor: THREE.Vector3,
  dist0 = 90,
) {
  r.crossVectors(dir, Y).normalize()
  u.crossVectors(r, dir)
  const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2)
  const bw = Math.max(0.1, rect.x1 - rect.x0)
  const bh = Math.max(0.1, rect.y1 - rect.y0)
  const rcx = (rect.x0 + rect.x1) / 2
  const rcy = (rect.y0 + rect.y1) / 2
  let D = dist0
  let sx = 0
  let sy = 0
  for (let i = 0; i < 8; i++) {
    cam.copy(anchor).addScaledVector(dir, -D).addScaledVector(r, sx).addScaledVector(u, sy)
    let q = bounds(keys, dir, t, aspect)
    const zoom = Math.max((q.x1 - q.x0) / bw, (q.y1 - q.y0) / bh)
    D *= zoom
    cam.copy(anchor).addScaledVector(dir, -D).addScaledVector(r, sx).addScaledVector(u, sy)
    q = bounds(keys, dir, t, aspect)
    // slide so the bounds' centre lands on the rect's centre
    sx -= (rcx - (q.x0 + q.x1) / 2) * D * t * aspect
    sy -= (rcy - (q.y0 + q.y1) / 2) * D * t
  }
  out.position.copy(anchor).addScaledVector(dir, -D).addScaledVector(r, sx).addScaledVector(u, sy)
  out.target.copy(out.position).addScaledVector(dir, D)
  return D
}
