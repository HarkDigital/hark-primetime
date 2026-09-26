import * as THREE from 'three'
import { PALETTE } from './field'
import { canvasTexture, drawMark, font, trackedText } from './type'
import { BOARD, BOARD_ASPECT } from '../world/board'

/*
 * Drawing your own video-board graphics (world.params.boardBg / boardMain).
 *
 *   const b = boardCanvas(ctx.mobile)          // a canvas at the board's aspect
 *   onFonts(() => { drawBoardBase(b.ctx, b.W, b.H, 'REPLAY'); …; b.tex.needsUpdate = true })
 *   // each frame you want it: world.params.boardBg = b.tex
 *
 *   dotMatrix(ctx, '10 YEARS', x, y, cell, color)   LED-style lettering
 *   BOARD.center / width / height                   where the screen is
 */
export { BOARD, BOARD_ASPECT }

export function boardCanvas(mobile: boolean) {
  const W = mobile ? 1024 : 2048
  const H = Math.round(W / BOARD_ASPECT)
  const c = canvasTexture(W, H)
  return { ...c, W, H }
}

/**
 * The house board look: navy gradient, faint diagonal stripes, the mark in a
 * corner bug, and an optional top-left segment title in a yellow tab.
 */
export function drawBoardBase(ctx: CanvasRenderingContext2D, W: number, H: number, title = '') {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#10234a')
  g.addColorStop(1, '#050b1a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = '#ffffff'
  for (let x = -H; x < W; x += H * 0.16) {
    ctx.beginPath()
    ctx.moveTo(x, H)
    ctx.lineTo(x + H * 0.06, H)
    ctx.lineTo(x + H * 0.56, 0)
    ctx.lineTo(x + H * 0.5, 0)
    ctx.fill()
  }
  ctx.restore()
  // corner bug
  const s = H * 0.11
  drawMark(ctx, W - s * 1.6, H - s * 1.5, s, '#ffffff', PALETTE.yellow)
  if (title) {
    ctx.save()
    ctx.font = font('display', H * 0.075, 800, true)
    const tw = ctx.measureText(title).width + title.length * H * 0.075 * 0.06
    ctx.fillStyle = PALETTE.yellow
    ctx.beginPath()
    ctx.moveTo(0, H * 0.05)
    ctx.lineTo(W * 0.03 + tw + H * 0.06, H * 0.05)
    ctx.lineTo(W * 0.03 + tw + H * 0.02, H * 0.15)
    ctx.lineTo(0, H * 0.15)
    ctx.fill()
    ctx.fillStyle = PALETTE.navyDeep
    ctx.textBaseline = 'middle'
    trackedText(ctx, title, W * 0.03, H * 0.102, 0.06, 'left')
    ctx.restore()
  }
}

/**
 * LED dot-matrix lettering: the text is rasterised at a coarse grid (one cell
 * per LED) and each lit cell drawn as a round dot. `cell` is the dot pitch in
 * canvas px; the text is `rows` LEDs tall. Returns the drawn width.
 */
export function dotMatrix(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  cell: number,
  color: string = PALETTE.yellow,
  { rows = 14, align = 'left' as 'left' | 'center' | 'right', face = 'display' as 'display' | 'mono', weight = 800 } = {},
) {
  const off = document.createElement('canvas')
  const oc = off.getContext('2d', { willReadFrequently: true })!
  oc.font = font(face, rows * 1.25, weight, face === 'display')
  const w = Math.ceil(oc.measureText(text).width) + 4
  off.width = w
  off.height = rows + 4
  oc.font = font(face, rows * 1.25, weight, face === 'display')
  oc.fillStyle = '#fff'
  oc.textBaseline = 'top'
  oc.fillText(text, 2, 1)
  const data = oc.getImageData(0, 0, off.width, off.height).data
  const x0 = align === 'left' ? x : align === 'center' ? x - (w * cell) / 2 : x - w * cell
  ctx.save()
  // unlit emitters behind (subtle)
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  for (let j = 0; j < off.height; j++)
    for (let i = 0; i < off.width; i++) {
      ctx.beginPath()
      ctx.arc(x0 + (i + 0.5) * cell, y + (j + 0.5) * cell, cell * 0.36, 0, Math.PI * 2)
      ctx.fill()
    }
  ctx.fillStyle = color
  for (let j = 0; j < off.height; j++)
    for (let i = 0; i < off.width; i++) {
      if (data[(j * off.width + i) * 4 + 3] < 110) continue
      ctx.beginPath()
      ctx.arc(x0 + (i + 0.5) * cell, y + (j + 0.5) * cell, cell * 0.42, 0, Math.PI * 2)
      ctx.fill()
    }
  ctx.restore()
  return w * cell
}

/** Where to aim a camera to frame the board: its centre, and a point in front of it. */
export function boardFront(dist: number, out = new THREE.Vector3()) {
  return out.copy(BOARD.center).add(new THREE.Vector3(-dist, 0, 0))
}
