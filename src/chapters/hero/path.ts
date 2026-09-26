import * as THREE from 'three'

/*
 * The hero's skycam: position and aim each ride a centripetal Catmull-Rom
 * spline through keyframes, and a monotone cubic maps local progress to the
 * spline parameter, so the camera accelerates out of the blimp shot and
 * lands at rest behind the ball without kinks or overshoot.
 *
 * Every key has a landscape and a portrait variant; each frame the curves'
 * control points are blended for the current aspect in place (no
 * allocation), then sampled. Pure function of (local, aspect blend).
 */

export type V3 = [number, number, number]

export interface Key {
  /** local progress where the camera passes this key */
  t: number
  /** position, aim, vertical fov (landscape) */
  p: V3
  q: V3
  f: number
  /** portrait overrides (default: the landscape values, fov widened) */
  pp?: V3
  pq?: V3
  pf?: number
}

/** Monotone cubic through (xs, ys): Fritsch–Butland slopes, flat at the far end. */
export function monotone(xs: number[], ys: number[]) {
  const n = xs.length
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]))
  const m: number[] = new Array(n).fill(0)
  m[0] = d[0] * 0.5
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i])
  m[n - 1] = 0
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0])
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const t = (x - xs[i]) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    )
  }
}

/** Widen a landscape fov for a narrow screen (keeps some of the horizontal coverage). */
export function adaptFov(fov: number, aspect: number) {
  if (aspect >= 1.3) return fov
  const k = Math.pow(1.3 / aspect, 0.62)
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * k))
}

export class SkyPath {
  readonly pos: THREE.CatmullRomCurve3
  readonly aim: THREE.CatmullRomCurve3
  private landP: THREE.Vector3[]
  private landQ: THREE.Vector3[]
  private portP: THREE.Vector3[]
  private portQ: THREE.Vector3[]
  private map: (x: number) => number
  private fovL: number[]
  private fovP: (number | undefined)[]
  readonly n: number

  constructor(keys: Key[]) {
    this.n = keys.length
    const v = (a: V3) => new THREE.Vector3(a[0], a[1], a[2])
    this.landP = keys.map(k => v(k.p))
    this.landQ = keys.map(k => v(k.q))
    this.portP = keys.map(k => v(k.pp ?? k.p))
    this.portQ = keys.map(k => v(k.pq ?? k.q))
    this.fovL = keys.map(k => k.f)
    this.fovP = keys.map(k => k.pf)
    this.pos = new THREE.CatmullRomCurve3(this.landP.map(p => p.clone()), false, 'centripetal')
    this.aim = new THREE.CatmullRomCurve3(this.landQ.map(p => p.clone()), false, 'centripetal')
    this.map = monotone(
      keys.map(k => k.t),
      keys.map((_, i) => i),
    )
  }

  /** The last key is live: chapters write it every frame (e.g. an aspect-dependent end pose). */
  get endPos() {
    return this.pos.points[this.n - 1]
  }
  get endAim() {
    return this.aim.points[this.n - 1]
  }

  /** Blend the control points for the aspect (0 landscape … 1 portrait). Call before sample(). */
  setAspect(a: number) {
    for (let i = 0; i < this.n - 1; i++) {
      this.pos.points[i].lerpVectors(this.landP[i], this.portP[i], a)
      this.aim.points[i].lerpVectors(this.landQ[i], this.portQ[i], a)
    }
  }

  /** Sample at local progress into outP/outQ; returns the fov. */
  sample(local: number, aspect: number, portrait: number, outP: THREE.Vector3, outQ: THREE.Vector3, endFov: number) {
    const s = Math.max(0, Math.min(this.n - 1, this.map(local)))
    const u = s / (this.n - 1)
    this.pos.getPoint(u, outP)
    this.aim.getPoint(u, outQ)
    // fov: Catmull-Rom (uniform) on the key fovs
    const i = Math.min(this.n - 2, Math.floor(s))
    const t = s - i
    const p0 = this.fovAt(i - 1, aspect, portrait, endFov)
    const p1 = this.fovAt(i, aspect, portrait, endFov)
    const p2 = this.fovAt(i + 1, aspect, portrait, endFov)
    const p3 = this.fovAt(i + 2, aspect, portrait, endFov)
    const t2 = t * t
    const t3 = t2 * t
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  }

  private fovAt(j: number, aspect: number, portrait: number, endFov: number) {
    const k = Math.max(0, Math.min(this.n - 1, j))
    if (k === this.n - 1) return endFov
    const land = adaptFov(this.fovL[k], aspect)
    const port = this.fovP[k]
    return port === undefined ? land : land + (port - land) * portrait
  }
}
