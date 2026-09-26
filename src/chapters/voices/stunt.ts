import * as THREE from 'three'
import { FIELD, PALETTE } from '../../kit/field'
import { TIERS, ringLength, standPoint } from '../../world/bowl'
import { HAZE_GLSL, WORLD_UNIFORMS, WORLD_UNIFORM_DECL } from '../../world/shared'
import { drawMark, font, trackedText } from '../../kit/type'
import { rng } from '../../core/math'

/*
 * THE CARD STUNT. A section of the lower bowl on the visitors' (−z) side —
 * the whole straight, x ∈ [−56, 56], across from the home broadcast camera —
 * holds up coloured cards that flip, section-wide, to form pictures.
 *
 *   one InstancedMesh, one card per seat-row position (cols × rows), laid
 *   over the rake with standPoint('lower', u, v) and facing its normal
 *
 *   per-instance attributes: aCell (column, row, two jitters), aFrom / aTo
 *   (palette indices). The shader rotates each card about its row axis
 *   (0 → π) once uFlip passes the card's delay, so flips sweep across the
 *   section; the FRONT face shows FROM, the BACK face shows TO.
 *
 *   pictures are rasterised once per image (2D canvas at SS× the card grid,
 *   averaged per card and snapped to the card palette); attributes are only
 *   rewritten when the FROM/TO pair changes.
 */

/** card palette indices (the shader's uPal) */
export const INK = { navy: 0, white: 1, yellow: 2, deep: 3 } as const
/** the colours a fan can hold up (sRGB) */
const PAL = ['#16337c', PALETTE.chalk, PALETTE.yellow, '#0b1633']

/** flip sweep patterns */
export const SWEEP = { ltr: 0, rtl: 1, center: 2 } as const

export interface StuntGrid {
  cols: number
  rows: number
  /** x extent along the straight (the section) */
  x0: number
  x1: number
  /** rake extent (standPoint v) */
  v0: number
  v1: number
}

/** ring u of the point at `x` on the −z straight, `d` yards out from the wall */
export function visitorsU(x: number, d: number) {
  const A = FIELD.wallX
  const B = FIELD.wallZ
  const R = FIELD.wallR
  const s = B - R + 3 * (Math.PI / 2) * (R + d) + 2 * (A - R) + 2 * (B - R) + (x + (A - R))
  return s / ringLength(d)
}

/** a point on the section (x along, v up the rake) with its facing normal */
export function sectionPoint(x: number, v: number, out: THREE.Vector3, normal?: THREE.Vector3) {
  const L = TIERS.lower
  const d = L.d0 + (L.d1 - L.d0) * v
  return standPoint('lower', visitorsU(x, d), v, out, normal)
}

/** cards float this far off the rake (in front of the crowd points) */
const LIFT = 0.78

const VERT = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform float uFlip, uDur, uPattern, uRM, uIdle;
uniform vec3 uPal[4];
attribute vec4 aCell;   // x: column 0..1 (west → east), y: row 0..1 (front → back), z/w: jitter
attribute float aFrom;
attribute float aTo;
varying vec3 vFrom;
varying vec3 vTo;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vShade;
varying float vMix;

vec3 pal(float i) {
  if (i < 0.5) return uPal[0];
  if (i < 1.5) return uPal[1];
  if (i < 2.5) return uPal[2];
  return uPal[3];
}

float delayOf(vec4 c) {
  float d;
  if (uPattern < 0.5) d = c.x;
  else if (uPattern < 1.5) d = 1.0 - c.x;
  else d = abs(c.x - 0.5) * 2.0;
  // a little lead for the front rows and a hand-held stagger
  return clamp(d * 0.86 + c.y * 0.06 + c.z * 0.08, 0.0, 1.0) * (1.0 - uDur);
}

void main() {
  vUv = uv;
  float rm = step(0.5, uRM);
  float f = clamp((uFlip - delayOf(aCell)) / uDur, 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);
  // hand-held: a fixed tilt per card plus a slight idle sway
  float sway = sin(uTime * (0.6 + aCell.w * 0.8) + aCell.w * 40.0) * 0.03 * uIdle;
  float a = f * 3.14159265 * (1.0 - rm) + (aCell.z - 0.5) * 0.16 + sway;
  float b = (aCell.w - 0.5) * 0.12;
  float ca = cos(a);
  float sa = sin(a);
  float cb = cos(b);
  float sb = sin(b);
  // rotate about the row (local x), then a small twist about local y
  vec3 p = vec3(position.x, position.y * ca, position.y * sa);
  vec3 n = vec3(0.0, -sa, ca);
  p = vec3(p.x * cb + p.z * sb, p.y, -p.x * sb + p.z * cb);
  n = vec3(n.x * cb + n.z * sb, n.y, -n.x * sb + n.z * cb);
  // cards come up toward the field as they turn
  p.z += sin(f * 3.14159265) * 0.22 * (1.0 - rm);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vFrom = pal(aFrom);
  vTo = pal(aTo);
  // reduced motion: no turning cards, a plain crossfade
  vMix = rm * smoothstep(0.0, 1.0, uFlip);
  vShade = 0.93 + 0.14 * aCell.w;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform float uRM;
uniform vec3 uKeyDir;
uniform vec2 uCard;
varying vec3 vFrom;
varying vec3 vTo;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vShade;
varying float vMix;
${HAZE_GLSL}
void main() {
  vec3 base = uRM > 0.5 ? mix(vFrom, vTo, vMix) : (gl_FrontFacing ? vFrom : vTo);
  vec3 n = normalize(gl_FrontFacing ? vN : -vN);
  // the home-side light banks
  float diff = max(dot(n, uKeyDir), 0.0);
  vec3 V = normalize(cameraPosition - vW);
  vec3 H = normalize(uKeyDir + V);
  float s = max(dot(n, H), 0.0);
  s *= s; s *= s; s *= s; s *= s; s *= s;  // ^32: a glint as a card turns through the light
  // a thin shaded edge per card, faded out where it would alias
  vec2 e = min(vUv, 1.0 - vUv) * uCard;
  float ed = min(e.x, e.y);
  float fw = fwidth(ed);
  float edge = smoothstep(0.0, 0.07 + fw, ed);
  float edgeAmt = 1.0 - smoothstep(0.03, 0.1, fw);
  float lit = uLights * (0.36 + 0.64 * diff) + 0.035;
  vec3 col = base * lit * vShade * mix(1.0, 0.62 + 0.38 * edge, edgeAmt) * uStands;
  col += vec3(0.85, 0.9, 1.0) * s * 0.2 * uLights;
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`

export interface Stunt {
  mesh: THREE.InstancedMesh
  grid: StuntGrid
  uniforms: {
    uFlip: { value: number }
    uDur: { value: number }
    uPattern: { value: number }
    uRM: { value: number }
    uIdle: { value: number }
  }
  /** show FROM → TO (palette-index images, cols*rows, row 0 = front row) */
  setPair(from: Uint8Array, to: Uint8Array): void
  /** world-space corners of the section (front-left, front-right, back-left, back-right) */
  corners: THREE.Vector3[]
  center: THREE.Vector3
}

export function buildStunt(grid: StuntGrid): Stunt {
  const { cols, rows, x0, x1, v0, v1 } = grid
  const count = cols * rows
  const pitchX = (x1 - x0) / cols
  const L = TIERS.lower
  const slant = Math.hypot(L.d1 - L.d0, L.h1 - L.h0) * (v1 - v0)
  const pitchV = slant / rows
  const cardW = pitchX * 0.88
  const cardH = pitchV * 0.84

  const geo = new THREE.PlaneGeometry(cardW, cardH)
  const cell = new Float32Array(count * 4)
  const aFrom = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
  const aTo = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
  aFrom.setUsage(THREE.DynamicDrawUsage)
  aTo.setUsage(THREE.DynamicDrawUsage)

  const uniforms = {
    ...WORLD_UNIFORMS,
    uFlip: { value: 1 },
    uDur: { value: 0.3 },
    uPattern: { value: 0 },
    uRM: { value: 0 },
    uIdle: { value: 1 },
    uPal: { value: PAL.map(c => new THREE.Color(c)) },
    uKeyDir: { value: new THREE.Vector3(0, 0.44, 0.9).normalize() },
    uCard: { value: new THREE.Vector2(cardW, cardH) },
  }
  // the chalk card sits just under the bloom threshold
  uniforms.uPal.value[1].multiplyScalar(0.92)

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.name = 'card-stunt'
  mesh.frustumCulled = false

  const rand = rng(1216)
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const X = new THREE.Vector3(1, 0, 0)
  const Y = new THREE.Vector3()
  const m = new THREE.Matrix4()
  for (let r = 0; r < rows; r++) {
    const v = v0 + ((r + 0.5) / rows) * (v1 - v0)
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * pitchX
      sectionPoint(x, v, p, n)
      p.addScaledVector(n, LIFT)
      Y.crossVectors(n, X)
      m.makeBasis(X, Y, n).setPosition(p)
      const i = r * cols + c
      mesh.setMatrixAt(i, m)
      cell[i * 4] = c / (cols - 1)
      cell[i * 4 + 1] = r / (rows - 1)
      cell[i * 4 + 2] = rand()
      cell[i * 4 + 3] = rand()
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 4))
  geo.setAttribute('aFrom', aFrom)
  geo.setAttribute('aTo', aTo)

  const corners = [
    [x0, v0],
    [x1, v0],
    [x0, v1],
    [x1, v1],
  ].map(([x, v]) => {
    const q = sectionPoint(x, v, new THREE.Vector3(), n)
    return q.addScaledVector(n, LIFT)
  })
  const center = sectionPoint(0, (v0 + v1) / 2, new THREE.Vector3(), n).addScaledVector(n, LIFT)

  const fromArr = aFrom.array as Float32Array
  const toArr = aTo.array as Float32Array
  return {
    mesh,
    grid,
    uniforms,
    corners,
    center,
    setPair(from, to) {
      for (let i = 0; i < count; i++) {
        fromArr[i] = from[i]
        toArr[i] = to[i]
      }
      aFrom.needsUpdate = true
      aTo.needsUpdate = true
    },
  }
}

/* ------------------------------------------------------------------ */
/* pictures: rasterised at the card grid                              */
/* ------------------------------------------------------------------ */

/** supersampling per card when rasterising */
const SS = 6
/** ink colours on the raster canvas: one channel per card colour */
const RASTER_INK = { white: '#ff0000', yellow: '#00ff00', deep: '#0000ff' }

let rasterCanvas: HTMLCanvasElement | null = null

function raster(grid: StuntGrid, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Uint8Array {
  const { cols, rows } = grid
  const w = cols * SS
  const h = rows * SS
  if (!rasterCanvas) rasterCanvas = document.createElement('canvas')
  const c = rasterCanvas
  if (c.width !== w) c.width = w
  if (c.height !== h) c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.save()
  draw(ctx, w, h)
  ctx.restore()
  const data = ctx.getImageData(0, 0, w, h).data
  const out = new Uint8Array(cols * rows)
  const norm = 1 / (255 * SS * SS)
  for (let r = 0; r < rows; r++) {
    // card row 0 is the FRONT row: the bottom of the picture
    const py = (rows - 1 - r) * SS
    for (let cI = 0; cI < cols; cI++) {
      let R = 0
      let G = 0
      let B = 0
      const px = cI * SS
      for (let y = 0; y < SS; y++) {
        let o = ((py + y) * w + px) * 4
        for (let x = 0; x < SS; x++, o += 4) {
          R += data[o]
          G += data[o + 1]
          B += data[o + 2]
        }
      }
      R *= norm
      G *= norm
      B *= norm
      let ink: number = INK.navy
      const mx = Math.max(R, G, B)
      if (mx > 0.42) ink = G >= mx ? INK.yellow : R >= mx ? INK.white : INK.deep
      out[r * cols + cI] = ink
    }
  }
  return out
}

/** a card's worth of pixels on the raster canvas */
const unit = () => SS

/** the section's frame: yellow rules along the front and back rows */
function rules(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const u = unit()
  ctx.fillStyle = RASTER_INK.yellow
  ctx.fillRect(0, 0, w, u)
  ctx.fillRect(0, h - u, w, u)
}

/** broadcast speed stripes at both ends of the section */
function stripes(ctx: CanvasRenderingContext2D, w: number, h: number, span: number) {
  const u = unit()
  ctx.fillStyle = RASTER_INK.yellow
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const cx = side < 0 ? (3 + i * 5) * u : w - (3 + i * 5) * u
      const bw = 2.2 * u
      const sk = h * 0.28
      ctx.beginPath()
      ctx.moveTo(cx - bw / 2 + sk / 2, 2 * u)
      ctx.lineTo(cx + bw / 2 + sk / 2, 2 * u)
      ctx.lineTo(cx + bw / 2 - sk / 2, h - 2 * u)
      ctx.lineTo(cx - bw / 2 - sk / 2, h - 2 * u)
      ctx.closePath()
      if (i < span) ctx.fill()
    }
  }
}

export function blankImage(grid: StuntGrid): Uint8Array {
  return new Uint8Array(grid.cols * grid.rows)
}

/** the Hark mark on navy: chalk loops, first-down yellow diamond */
export function markImage(grid: StuntGrid): Uint8Array {
  return raster(grid, (ctx, w, h) => {
    rules(ctx, w, h)
    stripes(ctx, w, h, 3)
    const s = h * 0.86
    drawMark(ctx, (w - s) / 2, (h - s) / 2, s, RASTER_INK.white, RASTER_INK.yellow)
  })
}

/** split `words` into `n` contiguous lines, every way */
function splits(words: string[], n: number): string[][] {
  if (n === 1) return [[words.join(' ')]]
  const out: string[][] = []
  for (let i = 1; i <= words.length - n + 1; i++) {
    const head = words.slice(0, i).join(' ')
    for (const rest of splits(words.slice(i), n - 1)) out.push([head, ...rest])
  }
  return out
}

/**
 * A client's company name in big condensed caps, fitted to the section: the
 * layout (1–3 lines) that gives the tallest letters wins. Nothing is shortened.
 */
export function nameImage(grid: StuntGrid, name: string): Uint8Array {
  return raster(grid, (ctx, w, h) => {
    rules(ctx, w, h)
    const u = unit()
    const words = name.toUpperCase().split(/\s+/)
    const REF = 100
    ctx.font = font('display', REF, 800, false)
    const capH = (ctx.measureText('H').actualBoundingBoxAscent || REF * 0.7) / REF
    const gap = 0.34
    // tracking keeps a clear navy card between letters (the shadow fills one)
    const track = 0.075
    const widthOf = (l: string) => ctx.measureText(l).width / REF + track * Math.max(0, [...l].length - 1)
    // room: two card columns each side, two rows under/over the text
    const availW = w - 5 * u
    const availH = h - 5 * u
    let best = { px: 0, lines: [name] as string[] }
    for (let n = 1; n <= Math.min(3, words.length); n++) {
      for (const lines of splits(words, n)) {
        const maxW = Math.max(...lines.map(widthOf))
        const px = Math.min(availW / maxW, availH / (capH * (n + (n - 1) * gap)))
        // prefer fewer lines unless more lines are clearly bigger
        if (px > best.px * 1.06) best = { px, lines }
      }
    }
    const { px, lines } = best
    ctx.font = font('display', px, 800, false)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const cap = capH * px
    const block = cap * (lines.length + (lines.length - 1) * gap)
    const y0 = (h - block) / 2 + cap
    // jersey lettering: a one-card deep-navy drop shadow, then the chalk face
    for (const [ink, dx, dy] of [
      [RASTER_INK.deep, u * 0.9, u * 0.9],
      [RASTER_INK.white, 0, 0],
    ] as const) {
      ctx.fillStyle = ink
      let y = y0
      for (const l of lines) {
        trackedText(ctx, l, w / 2 + dx, y + dy, track, 'center')
        y += cap * (1 + gap)
      }
    }
  })
}
