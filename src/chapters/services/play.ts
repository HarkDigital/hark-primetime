import * as THREE from 'three'
import { Route, arMaterial } from '../../kit/ar'
import { PALETTE } from '../../kit/field'

/*
 * Chapter-local telestrator helpers for the virtual playbook:
 *   polyRoute    waypoints → a polyline with small rounded breaks (crisp
 *                route cuts, like a coach's diagram)
 *   splineRoute  waypoints → a smooth curve (wheel / swing routes)
 *   PassArc      the throw: a dashed flight arc in the air (drawn 0..1 with
 *                the kit's AR material) over a faint dashed ground track
 */

export type Pt = [number, number]

/** A polyline through turf waypoints (x, z) with rounded breaks of radius r (yd). */
export function polyRoute(pts: Pt[], r = 0.9): THREE.Vector2[] {
  const v = pts.map(p => new THREE.Vector2(p[0], p[1]))
  const out: THREE.Vector2[] = [v[0].clone()]
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1]
    const c = v[i]
    const b = v[i + 1]
    const din = new THREE.Vector2().subVectors(c, a)
    const dout = new THREE.Vector2().subVectors(b, c)
    const rr = Math.min(r, din.length() * 0.45, dout.length() * 0.45)
    din.normalize()
    dout.normalize()
    const p0 = c.clone().addScaledVector(din, -rr)
    const p2 = c.clone().addScaledVector(dout, rr)
    const n = 8
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const u = 1 - t
      out.push(new THREE.Vector2(u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, u * u * p0.y + 2 * u * t * c.y + t * t * p2.y))
    }
  }
  out.push(v[v.length - 1].clone())
  return out
}

/** A smooth curve through turf waypoints, evenly resampled. */
export function splineRoute(pts: Pt[], samples = 72): THREE.Vector2[] {
  return new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1]))).getSpacedPoints(samples)
}

/** The throw: a dashed arc through the air from `from` to `to` (turf x, z), apex `peak` yd high. */
export class PassArc {
  group = new THREE.Group()
  material: THREE.ShaderMaterial
  private curve: THREE.QuadraticBezierCurve3
  private track: Route
  private _a = new THREE.Vector3()
  private _b = new THREE.Vector3()
  constructor(from: Pt, to: Pt, peak: number, { radius = 0.075, color = PALETTE.chalk as string, glow = 1.3, dash = 1.2 } = {}) {
    const a = new THREE.Vector3(from[0], 2.0, from[1])
    const b = new THREE.Vector3(to[0], 1.3, to[1])
    const c = a.clone().lerp(b, 0.5)
    c.y = 2 * peak - (a.y + b.y) / 2
    this.curve = new THREE.QuadraticBezierCurve3(a, c, b)
    const geo = new THREE.TubeGeometry(this.curve, 140, radius, 6, false)
    const uv = geo.getAttribute('uv')
    const at = new Float32Array(uv.count)
    const av = new Float32Array(uv.count).fill(0.5)
    for (let i = 0; i < uv.count; i++) at[i] = uv.getX(i)
    geo.setAttribute('aT', new THREE.BufferAttribute(at, 1))
    geo.setAttribute('aV', new THREE.BufferAttribute(av, 1))
    this.material = arMaterial({ color, glow, dash, chalk: 0, soft: 0.3 })
    this.material.uniforms.uLen.value = this.curve.getLength()
    this.material.polygonOffset = false
    const m = new THREE.Mesh(geo, this.material)
    m.frustumCulled = false
    m.renderOrder = 6
    this.group.add(m)
    this.track = new Route([new THREE.Vector2(from[0], from[1]), new THREE.Vector2(to[0], to[1])], {
      width: 0.2,
      color,
      glow: 1,
      dash: 0.8,
      chalk: 0.3,
      arrow: false,
      smooth: false,
    })
    this.group.add(this.track.group)
  }
  set(draw: number, opacity = 1) {
    const d = Math.max(0, Math.min(1, draw))
    this.material.uniforms.uDraw.value = d
    this.material.uniforms.uOpacity.value = opacity
    this.group.visible = d > 0.001 && opacity > 0.002
    this.track.set(d, opacity * 0.4)
  }
  /** a point along the flight (0..1, by arc length) */
  at(u: number, out: THREE.Vector3) {
    return this.curve.getPointAt(Math.max(0, Math.min(1, u)), out)
  }
  /** the unit direction of flight at u (no allocation) */
  tangent(u: number, out: THREE.Vector3) {
    const t = this.curve.getUtoTmapping(Math.max(0, Math.min(1, u)), 0)
    const { v0, v1, v2 } = this.curve
    this._a.subVectors(v1, v0).multiplyScalar(2 * (1 - t))
    this._b.subVectors(v2, v1).multiplyScalar(2 * t)
    return out.addVectors(this._a, this._b).normalize()
  }
}
