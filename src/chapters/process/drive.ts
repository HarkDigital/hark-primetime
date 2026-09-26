import * as THREE from 'three'
import { PALETTE } from '../../kit/field'
import { canvasTexture, font, onFonts, trackedText } from '../../kit/type'
import { drawBoardBase } from '../../kit/board'

/*
 * The Drive's own broadcast graphics (chapter-local; the kit has only flat
 * turf AR, and a drive chart needs its passes in the air):
 *
 *   PlayArc    a pass arc from spot to spot: a glowing tube in the air with a
 *              translucent "curtain" hanging from it to the turf (the 3D
 *              drive-chart look), drawn progressively (draw 0..1)
 *   TurfText   two-tone lettering keyed flat onto the turf ("01" + "LISTEN")
 *   chipTexture a navy score-bug chip for the per-play yardage tag
 *   drawStatsBoard  the video board's "by the numbers" graphic (LED lettering)
 *
 * All state comes from setters called in update(local): nothing accumulates.
 */

/** A parabola between two points (ends at their own heights), apex `h` above the chord. */
export class ArcCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    public a: THREE.Vector3,
    public b: THREE.Vector3,
    public h: number,
  ) {
    super()
  }
  getPoint(t: number, out: THREE.Vector3 = new THREE.Vector3()) {
    out.lerpVectors(this.a, this.b, t)
    out.y += 4 * this.h * t * (1 - t)
    return out
  }
}

const TUBE_VERT = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vW;
void main() {
  vT = uv.x;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const TUBE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uDraw, uHot, uGlint;
varying float vT;
varying vec3 vN;
varying vec3 vW;
void main() {
  if (vT > uDraw) discard;
  vec3 v = normalize(cameraPosition - vW);
  float facing = abs(dot(normalize(vN), v));
  // a bright core along the centre line, softer toward the silhouette
  float core = 0.5 + 0.5 * facing;
  // a hot tail right behind the ball while it's in the air
  float tail = smoothstep(uDraw - 0.3, uDraw, vT) * uHot;
  // idle: a soft glint travelling along the live arc (uGlint < 0 = off)
  float glint = step(0.0, uGlint) * (1.0 - smoothstep(0.0, 0.08, abs(vT - uGlint)));
  gl_FragColor = vec4(uColor * (core + tail * 0.9 + glint * 0.7), uOpacity * (0.55 + 0.45 * facing));
}
`

const CURTAIN_VERT = /* glsl */ `
attribute float aT;
attribute float aV;
varying float vT;
varying float vV;
varying float vY;
void main() {
  vT = aT;
  vV = aV;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uDraw;
varying float vT;
varying float vV;
varying float vY;
void main() {
  if (vT > uDraw) discard;
  // strongest right under the arc, fading toward the turf
  float a = vV * vV * 0.34 + vV * 0.05;
  // a crisp trace where the curtain meets the turf (the gain, on the grass)
  a += (1.0 - smoothstep(0.05, 0.22, vY)) * 0.5;
  // fade the leading edge in behind the ball
  a *= smoothstep(uDraw, uDraw - 0.04, vT) * 0.6 + 0.4;
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`

/** One play of the drive chart: a pass arc in the air plus its curtain. */
export class PlayArc {
  group = new THREE.Group()
  curve: ArcCurve
  apex = new THREE.Vector3()
  private tubeMat: THREE.ShaderMaterial
  private curtainMat: THREE.ShaderMaterial
  private hotColor = new THREE.Color(PALETTE.yellow).multiplyScalar(1.35)
  private dimColor = new THREE.Color(PALETTE.yellow).multiplyScalar(0.62)
  private curtainHot = new THREE.Color(PALETTE.yellow)
  private curtainDim = new THREE.Color('#e9e2c0')
  constructor(a: THREE.Vector3, b: THREE.Vector3, h: number, { radius = 0.2, segments = 96 } = {}) {
    this.curve = new ArcCurve(a.clone(), b.clone(), h)
    this.curve.getPointAt(0.5, this.apex)
    const tube = new THREE.TubeGeometry(this.curve, segments, radius, 10, false)
    this.tubeMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.hotColor.clone() },
        uOpacity: { value: 1 },
        uDraw: { value: 1 },
        uHot: { value: 0 },
        uGlint: { value: -1 },
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      depthWrite: false,
    })
    const tm = new THREE.Mesh(tube, this.tubeMat)
    tm.renderOrder = 7
    tm.frustumCulled = false

    // the curtain: a strip from the arc straight down to the turf
    const n = segments
    const pos = new Float32Array((n + 1) * 2 * 3)
    const at = new Float32Array((n + 1) * 2)
    const av = new Float32Array((n + 1) * 2)
    const p = new THREE.Vector3()
    for (let i = 0; i <= n; i++) {
      this.curve.getPointAt(i / n, p)
      const k = i * 6
      pos[k] = p.x
      pos[k + 1] = 0.03
      pos[k + 2] = p.z
      pos[k + 3] = p.x
      pos[k + 4] = p.y
      pos[k + 5] = p.z
      at[i * 2] = at[i * 2 + 1] = i / n
      av[i * 2] = 0
      av[i * 2 + 1] = 1
    }
    const idx: number[] = []
    for (let i = 0; i < n; i++) {
      const q = i * 2
      idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3)
    }
    const cg = new THREE.BufferGeometry()
    cg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    cg.setAttribute('aT', new THREE.BufferAttribute(at, 1))
    cg.setAttribute('aV', new THREE.BufferAttribute(av, 1))
    cg.setIndex(idx)
    this.curtainMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.curtainHot.clone() },
        uOpacity: { value: 1 },
        uDraw: { value: 1 },
      },
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const cm = new THREE.Mesh(cg, this.curtainMat)
    cm.renderOrder = 6
    cm.frustumCulled = false
    this.group.add(cm, tm)
  }

  /**
   * draw 0..1 along the arc; on 0..1 visibility; live 0..1 (1 = the current
   * play, bright; 0 = an earlier play, dimmed); hot 0..1 (in the air);
   * glint 0..1 along the arc (< 0 = none)
   */
  set(draw: number, on: number, live: number, hot = 0, glint = -1) {
    const d = Math.max(0, Math.min(1, draw))
    this.group.visible = d > 0.001 && on > 0.002
    const tu = this.tubeMat.uniforms
    const cu = this.curtainMat.uniforms
    tu.uDraw.value = d
    cu.uDraw.value = d
    ;(tu.uColor.value as THREE.Color).copy(this.dimColor).lerp(this.hotColor, live)
    ;(cu.uColor.value as THREE.Color).copy(this.curtainDim).lerp(this.curtainHot, live)
    tu.uOpacity.value = on * (0.72 + 0.28 * live)
    cu.uOpacity.value = on * (0.42 + 0.58 * live)
    tu.uHot.value = hot
    tu.uGlint.value = glint
  }
}

/** Two-tone turf lettering: `lead` in first-down yellow, `rest` in chalk. Readable from the home side. */
export class TurfText {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  constructor(lead: string, rest: string, { width = 12, px = 256, glow = 1.05 } = {}) {
    const c = canvasTexture(px * 4, px)
    const draw = () => {
      const { ctx, canvas } = c
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.font = font('display', px * 0.8, 800, true)
      ctx.textBaseline = 'middle'
      const gap = px * 0.22
      const wl = ctx.measureText(lead).width
      const wr = ctx.measureText(rest).width
      const total = wl + gap + wr
      const scale = Math.min(1, (canvas.width * 0.96) / Math.max(1, total))
      ctx.save()
      ctx.translate(canvas.width / 2, canvas.height / 2 + px * 0.04)
      ctx.scale(scale, 1)
      ctx.textAlign = 'left'
      // a soft dark key under the letters so they hold on bright grass
      ctx.shadowColor = 'rgba(4,10,24,0.55)'
      ctx.shadowBlur = px * 0.06
      ctx.fillStyle = PALETTE.yellow
      ctx.fillText(lead, -total / 2, 0)
      ctx.fillStyle = PALETTE.chalk
      ctx.fillText(rest, -total / 2 + wl + gap, 0)
      ctx.restore()
      c.tex.needsUpdate = true
    }
    onFonts(draw)
    this.material = new THREE.MeshBasicMaterial({
      map: c.tex,
      color: new THREE.Color(1, 1, 1).multiplyScalar(glow),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), this.material)
    // flat on the turf, the top of the letters toward -z (reads from the home sideline)
    const Y = new THREE.Vector3(0, 1, 0)
    const up = new THREE.Vector3(0, 0, -1)
    const right = new THREE.Vector3().crossVectors(up, Y)
    this.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, Y))
    this.mesh.position.y = 0.035
    this.mesh.renderOrder = 5
  }
  set(x: number, z: number, opacity: number) {
    this.mesh.position.x = x
    this.mesh.position.z = z
    this.material.opacity = opacity
    this.mesh.visible = opacity > 0.002
  }
}

/** A slanted navy chip with a yellow edge: "+21" in yellow, "YDS" in chalk. */
export function chipTexture(lead: string, rest: string, mobile: boolean) {
  const W = mobile ? 256 : 384
  const H = Math.round(W * 0.36)
  const c = canvasTexture(W, H, { mips: true, aniso: 4 })
  const draw = () => {
    const { ctx } = c
    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.transform(1, 0, -0.22, 1, 0, 0)
    ctx.fillStyle = 'rgba(8,18,40,0.94)'
    ctx.fillRect(-W * 0.42, -H * 0.38, W * 0.84, H * 0.76)
    ctx.fillStyle = PALETTE.yellow
    ctx.fillRect(-W * 0.42, -H * 0.38, W * 0.045, H * 0.76)
    ctx.restore()
    ctx.textBaseline = 'middle'
    ctx.font = font('display', H * 0.56, 800, true)
    const wl = ctx.measureText(lead).width
    ctx.font = font('mono', H * 0.3, 600)
    const wr = ctx.measureText(rest).width
    const gap = H * 0.12
    const x0 = W / 2 + W * 0.02 - (wl + gap + wr) / 2
    ctx.font = font('display', H * 0.56, 800, true)
    ctx.fillStyle = PALETTE.yellow
    ctx.fillText(lead, x0, H * 0.53)
    ctx.font = font('mono', H * 0.3, 600)
    ctx.fillStyle = PALETTE.chalk
    ctx.fillText(rest, x0 + wl + gap, H * 0.55)
    c.tex.needsUpdate = true
  }
  onFonts(draw)
  return { tex: c.tex, aspect: W / H }
}

/** A soft round shadow (grey on black: used as an alphaMap, which reads green). */
export function blobTexture() {
  const c = canvasTexture(128, 128, { mips: true, aniso: 1 })
  const g = c.ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.45, '#8a8a8a')
  g.addColorStop(1, '#000000')
  c.ctx.fillStyle = g
  c.ctx.fillRect(0, 0, 128, 128)
  c.tex.colorSpace = THREE.NoColorSpace
  c.tex.needsUpdate = true
  return c.tex
}

/**
 * LED lettering like the kit's dotMatrix, tuned for short stat values at a
 * coarse pitch: upright glyphs (italics stair-step into blobs on a grid), one
 * dark LED between letters so "15" never fuses, and a soft halo per lit LED.
 * Returns the drawn width in canvas px.
 */
export function ledText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  cell: number,
  color: string,
  { rows = 18, align = 'left' as 'left' | 'center' | 'right', weight = 700, gap = 1 } = {},
) {
  const off = document.createElement('canvas')
  const oc = off.getContext('2d', { willReadFrequently: true })!
  const f = font('display', rows * 1.3, weight, false)
  oc.font = f
  const chars = [...text]
  const cw = chars.map(c => Math.ceil(oc.measureText(c).width))
  const w = cw.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1) + 2
  off.width = w
  off.height = rows + 4
  oc.font = f
  oc.fillStyle = '#fff'
  oc.textBaseline = 'alphabetic'
  let cx = 1
  chars.forEach((c, i) => {
    oc.fillText(c, cx, rows + 1)
    cx += cw[i] + gap
  })
  const data = oc.getImageData(0, 0, off.width, off.height).data
  const x0 = align === 'left' ? x : align === 'center' ? x - (w * cell) / 2 : x - w * cell
  const lit: number[] = []
  for (let j = 0; j < off.height; j++) for (let i = 0; i < off.width; i++) if (data[(j * off.width + i) * 4 + 3] >= 120) lit.push(i, j)
  ctx.save()
  // unlit emitters behind (subtle)
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  ctx.beginPath()
  for (let j = 0; j < off.height; j++)
    for (let i = 0; i < off.width; i++) {
      const px = x0 + (i + 0.5) * cell
      const py = y + (j + 0.5) * cell
      ctx.moveTo(px + cell * 0.34, py)
      ctx.arc(px, py, cell * 0.34, 0, Math.PI * 2)
    }
  ctx.fill()
  // lit LEDs: a halo, then the core
  for (const [r, a] of [
    [0.62, 0.22],
    [0.42, 1],
  ] as const) {
    ctx.globalAlpha = a
    ctx.fillStyle = color
    ctx.beginPath()
    for (let k = 0; k < lit.length; k += 2) {
      const px = x0 + (lit[k] + 0.5) * cell
      const py = y + (lit[k + 1] + 0.5) * cell
      ctx.moveTo(px + cell * r, py)
      ctx.arc(px, py, cell * r, 0, Math.PI * 2)
    }
    ctx.fill()
  }
  ctx.restore()
  return w * cell
}

/** width in LED cells of ledText(text) at `rows` */
function ledCells(text: string, rows: number, weight = 700, gap = 1) {
  const oc = document.createElement('canvas').getContext('2d')!
  oc.font = font('display', rows * 1.3, weight, false)
  const chars = [...text]
  return chars.reduce((a, c) => a + Math.ceil(oc.measureText(c).width), 0) + gap * Math.max(0, chars.length - 1) + 2
}

export interface BoardStat {
  value: string
  lines: [string, string]
}

/**
 * The video board's stats graphic: the house base, a "BY THE NUMBERS" tab,
 * three columns — each value in LED dot-matrix, a two-line label under it.
 */
export function drawStatsBoard(ctx: CanvasRenderingContext2D, W: number, H: number, stats: BoardStat[], summary: string) {
  ctx.clearRect(0, 0, W, H)
  drawBoardBase(ctx, W, H, 'BY THE NUMBERS')
  const x0 = W * 0.03
  const x1 = W * 0.97
  const colW = (x1 - x0) / stats.length
  // one dot pitch for every value (the widest one sets it)
  const rows = 18
  const cellsW = stats.map(s => ledCells(s.value.toUpperCase(), rows))
  const cell = Math.min((H * 0.34) / (rows + 4), (colW * 0.9) / Math.max(...cellsW))
  const vTop = H * 0.22
  const vH = cell * (rows + 4)
  // one label size for every column, fitted to the widest line
  let lpx = H * 0.07
  ctx.font = font('display', lpx, 700, false)
  const tw = (t: string) => ctx.measureText(t).width + t.length * lpx * 0.05
  const widest = Math.max(...stats.flatMap(s => s.lines.map(tw)))
  lpx *= Math.min(1, (colW * 0.9) / widest)
  ctx.save()
  // column rules
  ctx.fillStyle = 'rgba(243,244,238,0.16)'
  for (let i = 1; i < stats.length; i++) ctx.fillRect(x0 + colW * i - 1, vTop, 2, vH + lpx * 2.9)
  stats.forEach((s, i) => {
    const cx = x0 + colW * (i + 0.5)
    ledText(ctx, s.value.toUpperCase(), cx, vTop, cell, PALETTE.yellow, { rows, align: 'center' })
    ctx.textBaseline = 'alphabetic'
    ctx.font = font('display', lpx, 700, false)
    ctx.fillStyle = PALETTE.chalk
    trackedText(ctx, s.lines[0], cx, vTop + vH + lpx * 1.05, 0.05, 'center')
    ctx.fillStyle = 'rgba(243,244,238,0.7)'
    trackedText(ctx, s.lines[1], cx, vTop + vH + lpx * 2.2, 0.05, 'center')
  })
  // the drive recap along the foot of the board (the corner bug sits bottom-right)
  const fy = H * 0.86
  ctx.fillStyle = 'rgba(243,244,238,0.18)'
  ctx.fillRect(x0, fy - H * 0.075, W * 0.78, 2)
  ctx.font = font('mono', H * 0.05, 600)
  ctx.textBaseline = 'middle'
  ctx.fillStyle = PALETTE.yellow
  const w0 = trackedText(ctx, 'THE DRIVE', x0, fy, 0.14, 'left')
  ctx.fillStyle = PALETTE.chalk
  trackedText(ctx, summary, x0 + w0 + H * 0.06, fy, 0.14, 'left')
  ctx.restore()
}
