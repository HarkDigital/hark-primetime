import * as THREE from 'three'
import { FIELD, PALETTE } from '../kit/field'
import { canvasTexture, font, onFonts, trackedText } from '../kit/type'
import { rng } from '../core/math'
import { BRAND } from '../content'
import { HAZE_GLSL, WORLD_UNIFORMS, WORLD_UNIFORM_DECL } from './shared'

/*
 * The bowl: a rounded-rectangle stadium around the field.
 *
 *   ring(u, d)    a point on the bowl's plan: u ∈ [0,1) around the rounded
 *                 rectangle (u = 0 at the EAST end, counter-clockwise seen
 *                 from above: east → +z (home) side → west → -z side), d
 *                 = yards outward from the field wall. Returns x, z and
 *                 the outward normal.
 *   standPoint()  a point on a seating tier: u around, v 0..1 up the rake.
 *
 *   LOWER tier    d 1.5 → 30, h 2.2 → 19 (all the way round)
 *   RIBBON        LED fascia at d 30.5, h 19.5 → 22.5 (all the way round)
 *   SUITES        glass band d 30.5 → 32, h 22.5 → 26
 *   UPPER tier    d 32.5 → 58, h 26.5 → 48 (not at the east end: the video
 *                 board stands there)
 */

const A = FIELD.wallX
const B = FIELD.wallZ
const R = FIELD.wallR

export const TIERS = {
  lower: { d0: 1.5, h0: 2.2, d1: 30, h1: 19 },
  upper: { d0: 32.5, h0: 26.5, d1: 58, h1: 48 },
  ribbon: { d: 30.5, h0: 19.5, h1: 22.5 },
  suites: { d0: 30.5, d1: 32, h0: 22.5, h1: 26 },
}
/** the upper tier spans u ∈ [UPPER_U0, 1 - UPPER_U0] (skips the east end) */
export const UPPER_U0 = 0.085

export interface RingPoint {
  x: number
  z: number
  nx: number
  nz: number
}

/** Perimeter of the plan offset `d` yards outward from the wall. */
export const ringLength = (d = 0) => 4 * (A - R) + 4 * (B - R) + 2 * Math.PI * (R + d)

/** A point on the bowl plan (see header). */
export function ring(u: number, d = 0, out: RingPoint = { x: 0, z: 0, nx: 0, nz: 0 }): RingPoint {
  const r = R + d
  const q = Math.PI / 2
  const segs: [number, (t: number) => void][] = [
    [B - R, t => set(A + d, t, 1, 0)],
    [q * r, t => arc(A - R, B - R, t / r)],
    [2 * (A - R), t => set(A - R - t, B + d, 0, 1)],
    [q * r, t => arc(-(A - R), B - R, q + t / r)],
    [2 * (B - R), t => set(-A - d, B - R - t, -1, 0)],
    [q * r, t => arc(-(A - R), -(B - R), 2 * q + t / r)],
    [2 * (A - R), t => set(-(A - R) + t, -B - d, 0, -1)],
    [q * r, t => arc(A - R, -(B - R), 3 * q + t / r)],
    [B - R, t => set(A + d, -(B - R) + t, 1, 0)],
  ]
  function set(x: number, z: number, nx: number, nz: number) {
    out.x = x
    out.z = z
    out.nx = nx
    out.nz = nz
  }
  function arc(cx: number, cz: number, a: number) {
    const c = Math.cos(a)
    const s = Math.sin(a)
    set(cx + c * r, cz + s * r, c, s)
  }
  let s = (((u % 1) + 1) % 1) * ringLength(d)
  for (const [len, fn] of segs) {
    if (s <= len) {
      fn(s)
      return out
    }
    s -= len
  }
  segs[segs.length - 1][1](segs[segs.length - 1][0])
  return out
}

/** A point on a seating tier (u around, v 0..1 up the rake), with the inward-facing normal. */
export function standPoint(tier: 'lower' | 'upper', u: number, v: number, out = new THREE.Vector3(), normal?: THREE.Vector3) {
  const t = TIERS[tier]
  const d = t.d0 + (t.d1 - t.d0) * v
  const h = t.h0 + (t.h1 - t.h0) * v
  const p = ring(u, d)
  out.set(p.x, h, p.z)
  if (normal) {
    // facing the field, tilted up by the rake
    const run = t.d1 - t.d0
    const rise = t.h1 - t.h0
    const len = Math.hypot(run, rise)
    normal.set(-p.nx * (rise / len), run / len, -p.nz * (rise / len))
  }
  return out
}

/** A strip surface between two profile points, swept around u ∈ [u0,u1]. */
function sweep(d0: number, h0: number, d1: number, h1: number, u0: number, u1: number, segs: number, rows: number) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const cols = segs + 1
  const p = { x: 0, z: 0, nx: 0, nz: 0 }
  for (let j = 0; j <= rows; j++) {
    const v = j / rows
    const d = d0 + (d1 - d0) * v
    const h = h0 + (h1 - h0) * v
    const len = ringLength(d)
    for (let i = 0; i <= segs; i++) {
      const u = u0 + (u1 - u0) * (i / segs)
      ring(u, d, p)
      pos.push(p.x, h, p.z)
      // uv.x in yards around (for aisles / LED pitch), uv.y 0..1 up the profile
      uv.push(u * len, v)
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < segs; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols
      const e = c + 1
      idx.push(a, c, b, b, c, e)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const STAND_VERT = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const STAND_FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform vec3 uSeat, uConcrete;
uniform float uRows, uTop, uAisles;
varying vec3 vW;
varying vec2 vUv;
${HAZE_GLSL}
void main() {
  float fpu = max(fwidth(vUv.x), 1e-3);
  float fpv = max(fwidth(vUv.y * uRows), 1e-3);
  // rows of seats: a dark riser line per row, faded where rows get sub-pixel
  float r = fract(vUv.y * uRows);
  float riser = (1.0 - smoothstep(0.0, 0.22 + fpv, r)) * (1.0 - smoothstep(0.4, 0.9, fpv));
  vec3 col = uSeat * (1.0 - 0.45 * riser);
  // aisles every 14 yards
  float a = abs(fract(vUv.x / 14.0 + 0.5) - 0.5) * 14.0;
  float aisle = 1.0 - smoothstep(0.55, 0.55 + fpu, a);
  col = mix(col, uConcrete, aisle * 0.8 * uAisles);
  // spill light from the field: brighter low in the bowl
  float lit = uLights * mix(0.9, 0.35, vUv.y * uTop) + 0.04;
  col *= lit * uStands;
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`

const CROWD_VERT = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform float uPx, uCrowd, uWave, uWaveOn, uMotion, uPhones;
attribute vec3 aColor;
attribute vec4 aInfo; // x: seed, y: ring u, z: 1 = phone light, w: tier row 0..1
varying vec3 vColor;
varying float vAlpha;
varying float vPhone;
void main() {
  vec3 p = position;
  float seed = aInfo.x;
  // idle fidget + the wave (people stand as it passes)
  float w = 0.0;
  if (uWaveOn > 0.5) {
    float du = abs(fract(aInfo.y - uWave + 0.5) - 0.5);
    w = 1.0 - smoothstep(0.0, 0.035, du);
  }
  p.y += (0.06 * sin(uTime * (1.3 + seed * 1.7) + seed * 40.0)) * uMotion + w * 0.65;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = 0.44 * uPx / max(1.0, -mv.z);
  gl_PointSize = clamp(size, 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
  float lit = uLights * mix(0.78, 0.4, aInfo.w) + 0.035;
  vColor = aColor * lit * (0.55 + 0.55 * fract(seed * 13.7)) * (1.0 + w * 0.8);
  vPhone = aInfo.z * uPhones * (0.6 + 0.4 * sin(uTime * 0.9 + seed * 30.0));
  vAlpha = uCrowd * clamp(size * 1.3, 0.3, 1.0);
}
`
const CROWD_FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
varying vec3 vColor;
varying float vAlpha;
varying float vPhone;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  vec3 col = vColor * uStands + vec3(2.2, 2.3, 2.6) * vPhone;
  gl_FragColor = vec4(col * vAlpha, 1.0);
}
`

/** The LED ribbon board: text texture scrolled around the bowl, LED dot mask. */
const RIBBON_FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform sampler2D map;
uniform float uRepeat, uScroll, uLevel;
varying vec3 vW;
varying vec2 vUv;
${HAZE_GLSL}
void main() {
  // vUv.x = yards around the bowl; the texture covers uRepeat yards
  vec2 t = vec2(vUv.x / uRepeat + uScroll, vUv.y);
  vec3 c = texture2D(map, t).rgb;
  // LED pitch: 0.12 yd; the mask averages out once the dots get sub-pixel
  vec2 g = vec2(vUv.x / 0.12, vUv.y * 25.0);
  vec2 f = fract(g) - 0.5;
  float fp = max(fwidth(g.x), fwidth(g.y));
  float dotm = 1.0 - smoothstep(0.28, 0.46, length(f));
  float m = mix(dotm * 1.5, 0.75, smoothstep(0.3, 0.8, fp));
  vec3 col = c * m * uLevel * 1.6 + vec3(0.004, 0.006, 0.012);
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`

const SUITES_FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
varying vec3 vW;
varying vec2 vUv;
float h1(float n) { return fract(sin(n * 91.7) * 43758.5); }
${HAZE_GLSL}
void main() {
  // a band of suite glass: mullions every 2.5 yd, some suites lit warm
  float cell = floor(vUv.x / 2.5);
  vec2 f = vec2(fract(vUv.x / 2.5), vUv.y);
  float fp = max(fwidth(vUv.x / 2.5), 1e-3);
  float pane = smoothstep(0.04, 0.04 + fp, f.x) * (1.0 - smoothstep(0.96 - fp, 0.96, f.x)) * step(0.3, f.y) * step(f.y, 0.82);
  float lit = step(0.45, h1(cell)) * (0.35 + 0.65 * h1(cell + 7.0));
  vec3 glass = mix(vec3(0.012, 0.016, 0.03), vec3(0.55, 0.38, 0.2) * 0.22, lit);
  vec3 col = mix(vec3(0.02, 0.025, 0.04), glass, pane);
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`

export function defaultRibbon(mobile: boolean) {
  const c = canvasTexture(mobile ? 2048 : 4096, 128, { mips: true })
  const draw = () => {
    const { ctx, canvas } = c
    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = PALETTE.navyDeep
    ctx.fillRect(0, 0, w, h)
    ctx.textBaseline = 'middle'
    const items = ['HARK.DIGITAL', BRAND.locale.toUpperCase(), 'HARK.DIGITAL', 'SOFTWARE · WEB · ECOMMERCE · SEO/GEO · SECURITY · AERIAL']
    ctx.font = font('display', h * 0.6, 800, true)
    const gap = h * 1.2
    const widths = items.map(t => ctx.measureText(t).width + t.length * h * 0.6 * 0.04)
    const total = widths.reduce((a, b) => a + b + gap, 0)
    // lay the cycle out once and stretch it to the canvas so the loop is seamless
    ctx.save()
    ctx.scale(w / total, 1)
    let x = 0
    items.forEach((t, i) => {
      ctx.fillStyle = PALETTE.yellow
      ctx.save()
      ctx.translate(x + gap / 2, h / 2)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-h * 0.09, -h * 0.09, h * 0.18, h * 0.18)
      ctx.restore()
      ctx.fillStyle = i % 2 ? '#e9edf5' : PALETTE.yellow
      trackedText(ctx, t, x + gap, h * 0.54, 0.04, 'left')
      x += widths[i] + gap
    })
    ctx.restore()
    c.tex.needsUpdate = true
  }
  onFonts(draw)
  c.tex.wrapS = THREE.RepeatWrapping
  return c.tex
}

export function buildBowl(mobile: boolean) {
  const group = new THREE.Group()
  group.name = 'bowl'
  const SEG = mobile ? 180 : 320

  const standMat = (seat: string, rows: number, aisles = rows > 1 ? 1 : 0) =>
    new THREE.ShaderMaterial({
      uniforms: {
        ...WORLD_UNIFORMS,
        uSeat: { value: new THREE.Color(seat) },
        uConcrete: { value: new THREE.Color('#2e3646') },
        uRows: { value: rows },
        uTop: { value: 1 },
        uAisles: { value: aisles },
      },
      vertexShader: STAND_VERT,
      fragmentShader: STAND_FRAG,
    })

  const L = TIERS.lower
  const U = TIERS.upper
  const lower = new THREE.Mesh(sweep(L.d0, L.h0, L.d1, L.h1, 0, 1, SEG, 4), standMat('#1b2742', 36))
  const upper = new THREE.Mesh(sweep(U.d0, U.h0, U.d1, U.h1, UPPER_U0, 1 - UPPER_U0, SEG, 4), standMat('#18223a', 30))
  // the field wall (padded, navy) and the backs/rims that close the silhouette
  const wall = new THREE.Mesh(sweep(0, 0, 0, 2.2, 0, 1, SEG, 1), standMat('#12203d', 1, 0))
  const ledge = new THREE.Mesh(sweep(0, 2.2, L.d0, L.h0, 0, 1, SEG, 1), standMat('#23304a', 1))
  const rim = new THREE.Mesh(sweep(U.d1, U.h1, U.d1 + 3, U.h1 + 2, UPPER_U0, 1 - UPPER_U0, SEG, 1), standMat('#10172a', 1))
  const back = new THREE.Mesh(sweep(U.d1 + 3, U.h1 + 2, U.d1 + 5, 0, UPPER_U0, 1 - UPPER_U0, SEG, 1), standMat('#070b14', 1, 0))
  const lowBack = new THREE.Mesh(sweep(TIERS.suites.d1, TIERS.suites.h1, TIERS.suites.d1 + 2, 0, 0, 1, SEG, 1), standMat('#070b14', 1, 0))
  for (const m of [lower, upper, wall, ledge, rim, back, lowBack]) {
    ;(m.material as THREE.ShaderMaterial).side = THREE.DoubleSide
    group.add(m)
  }

  // suites
  const S = TIERS.suites
  const suites = new THREE.Mesh(
    sweep(S.d0, S.h0, S.d0, S.h1, 0, 1, SEG, 1),
    new THREE.ShaderMaterial({ uniforms: { ...WORLD_UNIFORMS }, vertexShader: STAND_VERT, fragmentShader: SUITES_FRAG, side: THREE.DoubleSide }),
  )
  const suiteFloor = new THREE.Mesh(sweep(S.d0, S.h1, U.d0, U.h0, 0, 1, SEG, 1), standMat('#0c1222', 1))
  group.add(suites, suiteFloor)

  // LED ribbon board (default content; chapters can swap the map)
  const Rb = TIERS.ribbon
  const ribbonUniforms = {
    ...WORLD_UNIFORMS,
    map: { value: defaultRibbon(mobile) as THREE.Texture },
    uRepeat: { value: 120 },
    uScroll: { value: 0 },
    uLevel: { value: 1 },
  }
  const ribbon = new THREE.Mesh(
    sweep(Rb.d, Rb.h0, Rb.d, Rb.h1, 0, 1, SEG * 2, 1),
    new THREE.ShaderMaterial({ uniforms: ribbonUniforms, vertexShader: STAND_VERT, fragmentShader: RIBBON_FRAG, side: THREE.DoubleSide }),
  )
  group.add(ribbon)

  // ---- the crowd: one point per fan ----
  const rand = rng(2016)
  const pts: number[] = []
  const cols: number[] = []
  const info: number[] = []
  const palette = [
    ['#22335c', 0.3],
    ['#c9ccd2', 0.13],
    ['#d7ae33', 0.1],
    ['#1b1e25', 0.26],
    ['#7e2822', 0.04],
    ['#4a5670', 0.1],
    ['#8a6c55', 0.07],
  ] as const
  const colors = palette.map(([c]) => new THREE.Color(c))
  const pick = () => {
    let r = rand()
    for (let i = 0; i < palette.length; i++) {
      r -= palette[i][1]
      if (r <= 0) return colors[i]
    }
    return colors[0]
  }
  const seatGap = mobile ? 0.95 : 0.66
  const addTier = (tier: 'lower' | 'upper', rows: number, u0: number, u1: number) => {
    const t = TIERS[tier]
    for (let j = 0; j < rows; j++) {
      const v = (j + 0.5) / rows
      const d = t.d0 + (t.d1 - t.d0) * v
      const len = ringLength(d) * (u1 - u0)
      const n = Math.floor(len / seatGap)
      for (let i = 0; i < n; i++) {
        if (rand() < 0.12) continue // empty seats
        const u = u0 + ((i + rand() * 0.3) / n) * (u1 - u0)
        const p = standPoint(tier, u, v)
        pts.push(p.x, p.y + 0.55, p.z)
        const c = pick()
        cols.push(c.r, c.g, c.b)
        info.push(rand(), u, rand() < 0.035 ? 1 : 0, tier === 'lower' ? v * 0.5 : 0.5 + v * 0.5)
      }
    }
  }
  addTier('lower', mobile ? 24 : 34, 0, 1)
  addTier('upper', mobile ? 20 : 28, UPPER_U0, 1 - UPPER_U0)
  const crowdGeo = new THREE.BufferGeometry()
  crowdGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  crowdGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(cols, 3))
  crowdGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4))
  const crowdUniforms = {
    ...WORLD_UNIFORMS,
    uPx: { value: 800 },
    uCrowd: { value: 1 },
    uWave: { value: 0 },
    uWaveOn: { value: 0 },
    uMotion: { value: 1 },
    uPhones: { value: 0 },
  }
  const crowd = new THREE.Points(
    crowdGeo,
    new THREE.ShaderMaterial({ uniforms: crowdUniforms, vertexShader: CROWD_VERT, fragmentShader: CROWD_FRAG }),
  )
  crowd.frustumCulled = false
  group.add(crowd)

  return { group, ribbon, ribbonUniforms, crowd, crowdUniforms, crowdCount: pts.length / 3 }
}
