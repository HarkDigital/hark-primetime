import * as THREE from 'three'
import { PALETTE } from '../../kit/field'
import { boardCanvas, drawBoardBase, dotMatrix } from '../../kit/board'
import { canvasTexture, font, fontsReady, trackedText } from '../../kit/type'
import { ringLength, TIERS } from '../../world/bowl'
import type { WorkItem } from '../../content'

/*
 * The Highlights chapter's LED graphics:
 *   BoardArt   ONE board-sized canvas, redrawn only when the segment changes:
 *              'intro' = the HIGHLIGHTS open, 0..5 = REPLAY nn/06: a framed
 *              slot on the right where the world composites the screenshot
 *              (world.params.boardMain in SHOT_RECT; under it, the slot's own
 *              LED number + ▶ REPLAY card shows ahead of the wipe) and the
 *              tab / name / industry cluster hugging the slot's left edge.
 *   ribbon     the LED fascia texture: "Nine more, all live." + the nine
 *              other clients, laid out so a whole number of repeats wraps
 *              the bowl seamlessly.
 */

/** the screenshot slot on the board, in board uv (x, y, w, h; y up). 0.5 × 0.8 of 56 × 22 yd ≈ 16:10 */
export const SHOT_RECT = new THREE.Vector4(0.425, 0.1, 0.5, 0.8)

const pad2 = (n: number) => String(n).padStart(2, '0')

export type BoardState = 'intro' | number

export function createBoardArt(mobile: boolean, featured: WorkItem[]) {
  const b = boardCanvas(mobile)
  const { ctx, W, H } = b
  let current: BoardState | null = null

  // the slot under the picture (shows until a screenshot arrives, and ahead of the wipe)
  // Vector4 = (x, y, w, h) in uv with y up → canvas px with y down
  const slot = () => ({
    x: SHOT_RECT.x * W,
    y: (1 - SHOT_RECT.y - SHOT_RECT.w) * H,
    w: SHOT_RECT.z * W,
    h: SHOT_RECT.w * H,
  })

  /** the slot's own card (seen before the picture wipes over it): ▶ REPLAY and the LED number */
  function drawSlot(num: string) {
    const s = slot()
    ctx.save()
    ctx.fillStyle = '#040816'
    ctx.fillRect(s.x, s.y, s.w, s.h)
    const cx = s.x + s.w / 2
    const rows = 14
    const cell = (s.h * 0.4) / (rows + 4)
    const top = s.y + s.h * 0.14
    dotMatrix(ctx, num, cx, top, cell, PALETTE.yellow, { rows, align: 'center', face: 'mono', weight: 700 })
    // ▶ REPLAY under it
    const ly = top + (rows + 4) * cell + s.h * 0.16
    ctx.font = font('display', s.h * 0.1, 800, true)
    const lw = ctx.measureText('REPLAY').width + 6 * s.h * 0.1 * 0.08
    const tri = s.h * 0.075
    const x0 = cx - (lw + tri * 1.5) / 2
    ctx.fillStyle = PALETTE.yellow
    ctx.beginPath()
    ctx.moveTo(x0, ly - tri * 0.95)
    ctx.lineTo(x0 + tri * 0.9, ly - tri * 0.45)
    ctx.lineTo(x0, ly + tri * 0.05)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = PALETTE.chalk
    ctx.textBaseline = 'alphabetic'
    trackedText(ctx, 'REPLAY', x0 + tri * 1.5, ly + s.h * 0.035, 0.08, 'left')
    ctx.restore()
    // yellow corner brackets just outside the slot: the replay frame
    ctx.save()
    ctx.strokeStyle = PALETTE.yellow
    ctx.lineWidth = Math.max(2, H * 0.008)
    const o = H * 0.018
    const L = H * 0.09
    const corners: [number, number, number, number][] = [
      [s.x - o, s.y - o, 1, 1],
      [s.x + s.w + o, s.y - o, -1, 1],
      [s.x - o, s.y + s.h + o, 1, -1],
      [s.x + s.w + o, s.y + s.h + o, -1, -1],
    ]
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath()
      ctx.moveTo(x + dx * L, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y + dy * L)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** wrap `text` into lines no wider than maxW at the current font */
  function wrap(text: string, maxW: number) {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      const t = line ? `${line} ${w}` : w
      if (line && ctx.measureText(t).width > maxW) {
        lines.push(line)
        line = w
      } else line = t
    }
    if (line) lines.push(line)
    return lines
  }

  function drawIntro() {
    drawBoardBase(ctx, W, H, 'HIGHLIGHTS')
    // big LED lettering across the board (the mono face keeps its letters apart at LED pitch)
    const rows = 16
    ctx.font = font('mono', rows * 1.25, 700)
    const cells = Math.ceil(ctx.measureText('HIGHLIGHTS').width) + 4
    const cell = Math.min((W * 0.8) / cells, (H * 0.4) / (rows + 4))
    const top = H * 0.24
    dotMatrix(ctx, 'HIGHLIGHTS', W * 0.5, top, cell, PALETTE.yellow, { rows, align: 'center', face: 'mono', weight: 700 })
    // the package line under it
    const y = top + (rows + 4) * cell + H * 0.14
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    ctx.font = font('display', H * 0.105, 800, true)
    const t1 = 'SELECTED WORK'
    const w1 = ctx.measureText(t1).width + t1.length * H * 0.105 * 0.02
    ctx.font = font('mono', H * 0.05, 600)
    const t2 = `${pad2(featured.length)} REPLAYS`
    const w2 = ctx.measureText(t2).width + t2.length * H * 0.05 * 0.12
    const gap = H * 0.07
    let x = W * 0.5 - (w1 + gap + w2) / 2
    ctx.fillStyle = PALETTE.chalk
    ctx.font = font('display', H * 0.105, 800, true)
    trackedText(ctx, t1, x, y, 0.02, 'left')
    x += w1 + gap
    ctx.fillStyle = PALETTE.yellow
    ctx.fillRect(x - gap * 0.55, y - H * 0.075, Math.max(2, H * 0.006), H * 0.08)
    ctx.font = font('mono', H * 0.05, 600)
    trackedText(ctx, t2, x, y - H * 0.012, 0.12, 'left')
    ctx.restore()
  }

  /**
   * REPLAY nn/06: the picture slot on the right, and a compact column cluster
   * hugging the slot's left edge (tab, name, industry, LED number) — right-
   * aligned, so even the tightest camera, which crops the board's left half,
   * keeps it whole.
   */
  function drawReplay(i: number) {
    const w = featured[i]
    drawBoardBase(ctx, W, H)
    drawSlot(pad2(i + 1))
    const s = slot()
    const xr = s.x - H * 0.085
    const maxW = W * 0.2
    ctx.save()
    ctx.textBaseline = 'alphabetic'
    // the segment tab, level with the top of the slot
    const tabH = H * 0.1
    ctx.font = font('display', H * 0.072, 800, true)
    const title = `REPLAY ${pad2(i + 1)}/${pad2(featured.length)}`
    const tw = ctx.measureText(title).width + title.length * H * 0.072 * 0.05
    const pad = H * 0.035
    const tx0 = xr - tw - pad * 2
    ctx.fillStyle = PALETTE.yellow
    ctx.beginPath()
    ctx.moveTo(tx0 + tabH * 0.3, s.y)
    ctx.lineTo(xr + pad * 0.6, s.y)
    ctx.lineTo(xr + pad * 0.6 - tabH * 0.3, s.y + tabH)
    ctx.lineTo(tx0, s.y + tabH)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = PALETTE.navyDeep
    ctx.textBaseline = 'middle'
    trackedText(ctx, title, xr - pad * 0.2, s.y + tabH * 0.54, 0.05, 'right')
    ctx.textBaseline = 'alphabetic'
    // the name (≤ 2 lines, shrinking to fit the cluster)
    let size = H * 0.105
    let lines: string[] = []
    for (let k = 0; k < 10; k++) {
      ctx.font = font('display', size, 800, true)
      lines = wrap(w.name.toUpperCase(), maxW)
      const widest = Math.max(...lines.map(l => ctx.measureText(l).width))
      if (lines.length <= 2 && widest <= maxW) break
      size *= 0.92
    }
    ctx.fillStyle = PALETTE.chalk
    ctx.textAlign = 'right'
    const lh = size * 0.9
    const first = s.y + tabH + H * 0.07 + size * 0.78
    lines.forEach((l, j) => ctx.fillText(l, xr, first + j * lh))
    ctx.textAlign = 'left'
    // the industry in mono, wrapped to the cluster
    ctx.fillStyle = PALETTE.yellow
    const isz = H * 0.038
    ctx.font = font('mono', isz, 600)
    const ind = wrap(w.industry.toUpperCase(), maxW)
    let y = first + (lines.length - 1) * lh + H * 0.075
    for (const l of ind) {
      trackedText(ctx, l, xr, y, 0.04, 'right')
      y += isz * 1.3
    }
    // a first-down rule under the cluster
    ctx.fillRect(xr - H * 0.12, y - isz * 0.3 + H * 0.03, H * 0.12, Math.max(2, H * 0.008))
    ctx.restore()
  }

  function draw(s: BoardState) {
    ctx.clearRect(0, 0, W, H)
    if (s === 'intro') drawIntro()
    else drawReplay(s)
    b.tex.needsUpdate = true
  }

  // redraw the current state once the faces are in
  fontsReady().then(() => {
    if (current !== null) draw(current)
  })

  return {
    tex: b.tex,
    get state() {
      return current
    },
    /** redraws only when the state changes */
    show(s: BoardState) {
      if (s === current) return
      current = s
      draw(s)
    },
  }
}

/**
 * The LED ribbon for "Nine more, all live.": the lead-in and the nine names,
 * yellow diamonds between them. Returns the texture and the yards one repeat
 * covers (a whole number of repeats wraps the ribbon, so there's no seam).
 */
export function createRibbon(mobile: boolean, names: string[], lead: string) {
  const W = mobile ? 1024 : 2048
  const H = mobile ? 32 : 64
  const c = canvasTexture(W, H, { mips: true })
  c.tex.wrapS = THREE.RepeatWrapping
  const ring = ringLength(TIERS.ribbon.d)
  const yardsPerPx = (TIERS.ribbon.h1 - TIERS.ribbon.h0) / H
  const state = { repeat: 200 }
  const items = [lead, ...names].map(t => t.toUpperCase())
  const draw = () => {
    const { ctx } = c
    ctx.fillStyle = PALETTE.navyDeep
    ctx.fillRect(0, 0, W, H)
    ctx.font = font('display', H * 0.62, 800, true)
    ctx.textBaseline = 'middle'
    const gap = H * 1.3
    const widths = items.map(t => ctx.measureText(t).width + t.length * H * 0.62 * 0.03)
    const natural = widths.reduce((a, w) => a + w + gap, 0)
    // a whole number of repeats around the bowl, glyphs kept close to their true aspect
    const n = Math.max(1, Math.round(ring / (natural * yardsPerPx)))
    state.repeat = ring / n
    ctx.save()
    ctx.scale(W / natural, 1)
    let x = 0
    items.forEach((t, i) => {
      ctx.fillStyle = PALETTE.yellow
      ctx.save()
      ctx.translate(x + gap / 2, H / 2)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-H * 0.1, -H * 0.1, H * 0.2, H * 0.2)
      ctx.restore()
      ctx.fillStyle = i === 0 ? PALETTE.yellow : PALETTE.chalk
      trackedText(ctx, t, x + gap, H * 0.54, 0.03, 'left')
      x += widths[i] + gap
    })
    ctx.restore()
    c.tex.needsUpdate = true
  }
  draw()
  fontsReady().then(draw)
  return {
    tex: c.tex,
    get repeat() {
      return state.repeat
    },
  }
}
