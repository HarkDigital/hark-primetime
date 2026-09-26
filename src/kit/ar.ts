import * as THREE from 'three'
import { FIELD, PALETTE } from './field'
import { canvasTexture, font, onFonts, trackedText } from './type'
import { rng } from '../core/math'

/*
 * Broadcast AR graphics — the "virtual" layer a network keys onto the field:
 *
 *   ArLine     a line across the field at a yard line (the yellow first-down
 *              line, the blue line of scrimmage, a red-zone boundary)
 *   Puck       a player marker: a glowing ring on the turf, a translucent
 *              light pillar, and a floating number tag
 *   Route      a telestrator stroke along any path on the turf, drawn
 *              progressively (draw 0..1) with an arrowhead at the pen
 *   ArLabel    flat text keyed onto the turf (a yard marker, a stat)
 *   circlePath / xPath   hand-drawn telestrator shapes for Route
 *
 * All AR draws on top of the turf and paint (polygon offset, no depth
 * write) but is still hidden by anything in front of it. Colours are sRGB;
 * `glow` > 1 pushes them over the bloom threshold.
 * Everything is driven by setters you call from update(local) — no state
 * accumulates, so any local value renders the same.
 */

const AR_VERT = /* glsl */ `
attribute float aT;
attribute float aV;
varying float vT;
varying float vV;
varying vec3 vW;
void main() {
  vT = aT;
  vV = aV;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const AR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uDraw, uDash, uChalk, uLen, uSoft;
varying float vT;
varying float vV;
varying vec3 vW;
float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  if (vT > uDraw) discard;
  // soft edges across the stroke
  float edge = smoothstep(0.0, uSoft, vV) * smoothstep(1.0, 1.0 - uSoft, vV);
  float a = edge * uOpacity;
  if (uDash > 0.0) a *= step(0.45, fract(vT * uLen / uDash));
  // telestrator chalk: a little grain along the stroke
  a *= 1.0 - uChalk * 0.45 * h(floor(vec2(vT * uLen * 12.0, vV * 3.0)));
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`

export interface ArMatOptions {
  color?: THREE.ColorRepresentation
  /** HDR multiplier on the colour (> 1 blooms) */
  glow?: number
  opacity?: number
  /** dash length in yards (0 = solid) */
  dash?: number
  /** chalk grain 0..1 */
  chalk?: number
  /** edge softness 0..0.5 of the stroke width */
  soft?: number
}

export function arMaterial({ color = PALETTE.yellow, glow = 1.15, opacity = 1, dash = 0, chalk = 0, soft = 0.18 }: ArMatOptions = {}) {
  const c = new THREE.Color(color).multiplyScalar(glow)
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: c },
      uOpacity: { value: opacity },
      uDraw: { value: 1 },
      uDash: { value: dash },
      uChalk: { value: chalk },
      uLen: { value: 1 },
      uSoft: { value: soft },
    },
    vertexShader: AR_VERT,
    fragmentShader: AR_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  })
}

/** A flat ribbon along points on the turf (y = 0.03), with aT (0..1 along) and aV (0..1 across). */
export function ribbonGeometry(points: THREE.Vector2[], width: number, y = 0.03) {
  const n = points.length
  const pos = new Float32Array(n * 2 * 3)
  const at = new Float32Array(n * 2)
  const av = new Float32Array(n * 2)
  const cum = [0]
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]))
  const total = Math.max(cum[n - 1], 1e-6)
  const t = new THREE.Vector2()
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(n - 1, i + 1)]
    t.subVectors(b, a).normalize()
    // normal in XZ (turf plane: point.x = world x, point.y = world z)
    const nx = -t.y
    const nz = t.x
    for (let s = 0; s < 2; s++) {
      const k = (i * 2 + s) * 3
      const side = s === 0 ? -0.5 : 0.5
      pos[k] = points[i].x + nx * width * side
      pos[k + 1] = y
      pos[k + 2] = points[i].y + nz * width * side
      at[i * 2 + s] = cum[i] / total
      av[i * 2 + s] = s
    }
  }
  const idx: number[] = []
  // wind to face +y (visible from above without DoubleSide)
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(at, 1))
  g.setAttribute('aV', new THREE.BufferAttribute(av, 1))
  g.setIndex(idx)
  // make sure the winding faces up
  const p0 = new THREE.Vector3(pos[0], pos[1], pos[2])
  const p1 = new THREE.Vector3(pos[6], pos[7], pos[8])
  const p2 = new THREE.Vector3(pos[3], pos[4], pos[5])
  const nrm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0))
  if (nrm.y < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]]
    g.setIndex(idx)
  }
  return { geometry: g, length: total, cum }
}

/**
 * A line across the field at yard line `yd` (from the west goal line):
 *   const fd = new ArLine({ color: PALETTE.yellow }); group.add(fd.mesh)
 *   fd.set(35, 1)   // at the 35 (west side), fully drawn
 */
export class ArLine {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  constructor({ color = PALETTE.yellow, width = 0.3, glow = 1.1, span = FIELD.halfWidth }: { color?: THREE.ColorRepresentation; width?: number; glow?: number; span?: number } = {}) {
    const { geometry, length } = ribbonGeometry([new THREE.Vector2(0, -span), new THREE.Vector2(0, span)], width, 0.025)
    this.material = arMaterial({ color, glow, soft: 0.12 })
    this.material.uniforms.uLen.value = length
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.renderOrder = 4
    this.mesh.frustumCulled = false
  }
  /** yd from the west goal line; opacity; draw 0..1 (paints on from the far sideline) */
  set(yd: number, opacity = 1, draw = 1) {
    this.mesh.position.x = yd - 50
    this.material.uniforms.uOpacity.value = opacity
    this.material.uniforms.uDraw.value = draw
    this.mesh.visible = opacity > 0.002 && draw > 0.001
  }
}

/** A stroke along a path on the turf, drawn progressively, with an arrowhead. */
export class Route {
  group = new THREE.Group()
  material: THREE.ShaderMaterial
  length: number
  private curve: THREE.CurvePath<THREE.Vector2> | THREE.SplineCurve
  private head: THREE.Mesh | null = null
  private headMat: THREE.MeshBasicMaterial | null = null
  private pts: THREE.Vector2[]
  private cum: number[]
  constructor(
    /** path points in turf coordinates: Vector2(x, z) */
    path: THREE.Vector2[],
    {
      width = 0.32,
      color = PALETTE.yellow,
      glow = 1.2,
      dash = 0,
      chalk = 0.6,
      arrow = true,
      smooth = true,
      samples = 96,
    }: { width?: number; color?: THREE.ColorRepresentation; glow?: number; dash?: number; chalk?: number; arrow?: boolean; smooth?: boolean; samples?: number } = {},
  ) {
    this.curve = new THREE.SplineCurve(path)
    this.pts = smooth ? (this.curve as THREE.SplineCurve).getSpacedPoints(samples) : path
    const r = ribbonGeometry(this.pts, width)
    this.length = r.length
    this.cum = r.cum
    this.material = arMaterial({ color, glow, dash, chalk })
    this.material.uniforms.uLen.value = r.length
    const m = new THREE.Mesh(r.geometry, this.material)
    m.renderOrder = 5
    m.frustumCulled = false
    this.group.add(m)
    if (arrow) {
      const s = new THREE.Shape()
      s.moveTo(0, width * 1.9)
      s.lineTo(-width * 1.5, -width * 0.9)
      s.lineTo(width * 1.5, -width * 0.9)
      s.closePath()
      const g = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2)
      this.headMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(glow),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -8,
      })
      this.head = new THREE.Mesh(g, this.headMat)
      this.head.renderOrder = 5
      this.group.add(this.head)
    }
  }
  /** draw 0..1 along the path; opacity 0..1 */
  set(draw: number, opacity = 1) {
    const d = Math.max(0, Math.min(1, draw))
    this.material.uniforms.uDraw.value = d
    this.material.uniforms.uOpacity.value = opacity
    this.group.visible = d > 0.001 && opacity > 0.002
    if (this.head && this.headMat) {
      const target = d * this.length
      let i = 1
      while (i < this.cum.length - 1 && this.cum[i] < target) i++
      const a = this.pts[i - 1]
      const b = this.pts[i]
      const seg = Math.max(this.cum[i] - this.cum[i - 1], 1e-6)
      const f = Math.max(0, Math.min(1, (target - this.cum[i - 1]) / seg))
      this.head.position.set(a.x + (b.x - a.x) * f, 0.035, a.y + (b.y - a.y) * f)
      // shape points +z-ish after rotateX(-90°): its tip is local -z; face along the tangent
      const ang = Math.atan2(b.x - a.x, b.y - a.y)
      this.head.rotation.set(0, ang + Math.PI, 0)
      this.headMat.opacity = opacity * Math.min(1, d * 12)
    }
  }
  /** a point along the path (0..1) in turf coords */
  at(t: number, out = new THREE.Vector2()) {
    return (this.curve as THREE.SplineCurve).getPointAt(Math.max(0, Math.min(1, t)), out)
  }
}

/** A hand-drawn telestrator circle (overshoots its start a little). */
export function circlePath(cx: number, cz: number, r: number, seed = 1, turns = 1.12): THREE.Vector2[] {
  const rand = rng(seed)
  const out: THREE.Vector2[] = []
  const n = 40
  const a0 = rand() * Math.PI * 2
  const wob = [rand(), rand(), rand()]
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = a0 + t * Math.PI * 2 * turns
    const rr = r * (1 + 0.06 * Math.sin(a * 2 + wob[0] * 6) + 0.04 * Math.sin(a * 3 + wob[1] * 6) + t * 0.05)
    out.push(new THREE.Vector2(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr * (1 + 0.05 * wob[2])))
  }
  return out
}

/** A telestrator X as two strokes (build a Route from each). */
export function xPaths(cx: number, cz: number, s: number): [THREE.Vector2[], THREE.Vector2[]] {
  return [
    [new THREE.Vector2(cx - s, cz - s), new THREE.Vector2(cx + s, cz + s)],
    [new THREE.Vector2(cx + s, cz - s), new THREE.Vector2(cx - s, cz + s)],
  ]
}

const PILLAR_VERT = /* glsl */ `
varying float vY;
varying vec3 vN;
varying vec3 vW;
void main() {
  vY = uv.y;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const PILLAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vY;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 v = normalize(cameraPosition - vW);
  float rim = 1.0 - abs(dot(normalize(vN), v));
  float a = (1.0 - vY) * (1.0 - vY) * (0.25 + 0.75 * rim) * uOpacity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`

/** Number tag canvas: a navy chip with a yellow number (broadcast style). */
function tagTexture(label: string, color: string) {
  const c = canvasTexture(256, 128, { mips: true, aniso: 4 })
  const draw = () => {
    const { ctx } = c
    ctx.clearRect(0, 0, 256, 128)
    ctx.save()
    ctx.translate(128, 64)
    ctx.transform(1, 0, -0.22, 1, 0, 0)
    ctx.fillStyle = 'rgba(8,18,40,0.92)'
    ctx.fillRect(-100, -44, 200, 88)
    ctx.fillStyle = color
    ctx.fillRect(-100, -44, 12, 88)
    ctx.restore()
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'middle'
    ctx.font = font('display', 78, 800, true)
    trackedText(ctx, label, 136, 68, 0.02, 'center')
    c.tex.needsUpdate = true
  }
  onFonts(draw)
  return c.tex
}

/**
 * A player marker. `number` shows on the floating tag.
 *   const p = new Puck({ number: '07' }); group.add(p.group)
 *   p.set(x, z, { on: 1, glow: 0.3, tag: 1 })
 */
export class Puck {
  group = new THREE.Group()
  private ring: THREE.Mesh
  private disc: THREE.Mesh
  private pillar: THREE.Mesh
  private tag: THREE.Sprite
  private ringMat: THREE.MeshBasicMaterial
  private discMat: THREE.MeshBasicMaterial
  private pillarMat: THREE.ShaderMaterial
  private tagMat: THREE.SpriteMaterial
  private base: THREE.Color
  private hot: THREE.Color
  constructor({
    number = '',
    color = '#ffffff',
    hot = PALETTE.yellow,
    radius = 0.9,
    pillar = 3.2,
  }: { number?: string; color?: THREE.ColorRepresentation; hot?: THREE.ColorRepresentation; radius?: number; pillar?: number } = {}) {
    this.base = new THREE.Color(color)
    this.hot = new THREE.Color(hot)
    const flat = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.base.clone(), ...flat })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.84, radius, 48).rotateX(-Math.PI / 2), this.ringMat)
    this.ring.position.y = 0.03
    this.ring.renderOrder = 5
    this.discMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.navy), opacity: 0.55, ...flat })
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.84, 40).rotateX(-Math.PI / 2), this.discMat)
    this.disc.position.y = 0.028
    this.disc.renderOrder = 4
    this.pillarMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.base.clone() }, uOpacity: { value: 0.35 } },
      vertexShader: PILLAR_VERT,
      fragmentShader: PILLAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.pillar = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius * 0.9, pillar, 32, 1, true).translate(0, pillar / 2, 0), this.pillarMat)
    this.pillar.renderOrder = 6
    this.tagMat = new THREE.SpriteMaterial({ map: number ? tagTexture(number, `#${this.hot.getHexString()}`) : null, transparent: true, depthWrite: false })
    this.tag = new THREE.Sprite(this.tagMat)
    this.tag.scale.set(1.9, 0.95, 1)
    this.tag.position.y = pillar + 0.8
    this.tag.renderOrder = 7
    this.tag.visible = !!number
    this.group.add(this.disc, this.ring, this.pillar, this.tag)
  }
  /**
   * on: overall visibility 0..1; hot: 0..1 highlight (ring/pillar go accent,
   * brighter); tag: number tag 0..1; pillar: light column 0..1
   */
  set(x: number, z: number, { on = 1, hot = 0, tag = 1, pillar = 1 }: { on?: number; hot?: number; tag?: number; pillar?: number } = {}) {
    this.group.position.set(x, 0, z)
    this.group.visible = on > 0.002
    const c = this.ringMat.color.copy(this.base).lerp(this.hot, hot).multiplyScalar(1.05 + hot * 0.9)
    this.ringMat.opacity = on
    this.discMat.opacity = 0.55 * on
    ;(this.pillarMat.uniforms.uColor.value as THREE.Color).copy(c)
    this.pillarMat.uniforms.uOpacity.value = (0.22 + 0.5 * hot) * on * pillar
    this.pillar.visible = pillar * on > 0.002
    this.tagMat.opacity = tag * on
    this.tag.visible = !!this.tagMat.map && tag * on > 0.002
    const s = 1 + hot * 0.12
    this.ring.scale.setScalar(s)
  }
}

/**
 * Flat text keyed onto the turf, e.g. new ArLabel('1ST & 10', { width: 8 }).
 * Reads with its top toward `up` ('-z' = readable from the home sideline).
 */
export class ArLabel {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  private c: ReturnType<typeof canvasTexture>
  constructor(
    public text: string,
    {
      width = 8,
      color = '#ffffff',
      face = 'display' as const,
      weight = 800,
      italic = true,
      glow = 1.1,
      up = '-z' as 'x' | '-x' | 'z' | '-z',
      px = 256,
    }: { width?: number; color?: string; face?: 'display' | 'sans' | 'mono'; weight?: number; italic?: boolean; glow?: number; up?: 'x' | '-x' | 'z' | '-z'; px?: number } = {},
  ) {
    this.c = canvasTexture(px * 4, px)
    const draw = () => {
      const { ctx, canvas } = this.c
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.font = font(face, px * 0.78, weight, italic)
      ctx.fillStyle = color
      ctx.textBaseline = 'middle'
      const w = ctx.measureText(this.text).width
      const scale = Math.min(1, (canvas.width * 0.96) / Math.max(1, w))
      ctx.save()
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.scale(scale, 1)
      ctx.textAlign = 'center'
      ctx.fillText(this.text, 0, px * 0.04)
      ctx.restore()
      this.c.tex.needsUpdate = true
    }
    onFonts(draw)
    this.material = new THREE.MeshBasicMaterial({
      map: this.c.tex,
      color: new THREE.Color(1, 1, 1).multiplyScalar(glow),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), this.material)
    const Y = new THREE.Vector3(0, 1, 0)
    const u = new THREE.Vector3(up === 'x' ? 1 : up === '-x' ? -1 : 0, 0, up === 'z' ? 1 : up === '-z' ? -1 : 0)
    const right = new THREE.Vector3().crossVectors(u, Y)
    this.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, u, Y))
    this.mesh.position.y = 0.03
    this.mesh.renderOrder = 5
  }
  set(x: number, z: number, opacity = 1) {
    this.mesh.position.x = x
    this.mesh.position.z = z
    this.material.opacity = opacity
    this.mesh.visible = opacity > 0.002
  }
}
