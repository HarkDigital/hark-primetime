import * as THREE from 'three'
import { boardCanvas, dotMatrix, drawBoardBase } from '../../kit/board'
import { PALETTE } from '../../kit/field'
import { canvasTexture, font, onFonts, trackedText } from '../../kit/type'

/*
 * Shield's broadcast graphics, drawn once (and again when the fonts land):
 *   redZoneBoard   the video board in alarm: RED ZONE in red LEDs
 *   onWatchBoard   the calm board: 24/7 on a play-clock plate
 *   redZoneRibbon  the LED ribbon crawl while the offense is at the 1
 * All decorative broadcast text (no business claims beyond the 24/7 stat).
 */

const RED = PALETTE.red

/** Hazard chevrons across a band (low alpha). */
function chevrons(ctx: CanvasRenderingContext2D, W: number, y: number, h: number, color: string, alpha: number) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, y, W, h)
  ctx.clip()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  const step = h * 1.3
  for (let x = -h * 2; x < W + h * 2; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, y + h)
    ctx.lineTo(x + step * 0.5, y + h)
    ctx.lineTo(x + step * 0.5 + h, y)
    ctx.lineTo(x + h, y)
    ctx.fill()
  }
  ctx.restore()
}

export function redZoneBoard(mobile: boolean) {
  const b = boardCanvas(mobile)
  const { ctx, W, H } = b
  const draw = () => {
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#2a0706')
    g.addColorStop(0.55, '#170304')
    g.addColorStop(1, '#0c0203')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // hazard bands top and bottom
    chevrons(ctx, W, 0, H * 0.075, RED, 0.34)
    chevrons(ctx, W, H * 0.925, H * 0.075, RED, 0.34)
    // inner frame
    ctx.strokeStyle = 'rgba(255,75,58,0.55)'
    ctx.lineWidth = H * 0.008
    ctx.strokeRect(W * 0.025, H * 0.11, W * 0.95, H * 0.78)
    // RED ZONE in LEDs
    const cell = Math.round(H * 0.031)
    dotMatrix(ctx, 'RED ZONE', W / 2, H * 0.2, cell, RED, { rows: 14, align: 'center' })
    // the down and distance
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    ctx.font = font('display', H * 0.1, 800, true)
    trackedText(ctx, '1ST & GOAL', W * 0.5, H * 0.82, 0.04, 'center')
    ctx.fillStyle = RED
    ctx.font = font('mono', H * 0.042, 600)
    trackedText(ctx, 'BALL ON THE 1', W * 0.075, H * 0.82 - H * 0.03, 0.16, 'left')
    trackedText(ctx, 'BREACH ALERT', W * 0.925, H * 0.82 - H * 0.03, 0.16, 'right')
    b.tex.needsUpdate = true
  }
  onFonts(draw)
  return b.tex
}

export function onWatchBoard(mobile: boolean) {
  const b = boardCanvas(mobile)
  const { ctx, W, H } = b
  const draw = () => {
    drawBoardBase(ctx, W, H, 'GOAL-LINE STAND')
    // the play-clock plate
    const px = W * 0.06
    const py = H * 0.22
    const pw = W * 0.54
    const ph = H * 0.62
    ctx.fillStyle = 'rgba(3,8,20,0.82)'
    ctx.fillRect(px, py, pw, ph)
    ctx.strokeStyle = PALETTE.yellow
    ctx.lineWidth = H * 0.008
    ctx.strokeRect(px, py, pw, ph)
    ctx.fillStyle = PALETTE.yellow
    ctx.fillRect(px, py, pw, H * 0.012)
    const cell = Math.round(H * 0.026)
    dotMatrix(ctx, '24/7', px + pw / 2, py + ph * 0.13, cell, PALETTE.yellow, { rows: 14, align: 'center' })
    // right column: the stat, in the network's type
    const cx = W * 0.64
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    ctx.font = font('display', H * 0.13, 800, true)
    trackedText(ctx, 'MONITORING', cx, H * 0.45, 0.02, 'left')
    ctx.fillStyle = PALETTE.yellow
    ctx.font = font('mono', H * 0.045, 600)
    trackedText(ctx, 'WITH A HUMAN', cx + H * 0.01, H * 0.56, 0.14, 'left')
    trackedText(ctx, 'WHO RESPONDS', cx + H * 0.01, H * 0.63, 0.14, 'left')
    ctx.fillStyle = 'rgba(243,244,238,0.5)'
    ctx.fillRect(cx + H * 0.01, H * 0.7, W * 0.12, H * 0.006)
    b.tex.needsUpdate = true
  }
  onFonts(draw)
  return b.tex
}

/** The LED ribbon while the offense is at the 1 (one repeat = RIBBON_YARDS). */
export const RIBBON_YARDS = 64
export function redZoneRibbon(mobile: boolean) {
  const c = canvasTexture(mobile ? 1024 : 2048, 128, { mips: true })
  const draw = () => {
    const { ctx, canvas } = c
    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = '#170404'
    ctx.fillRect(0, 0, w, h)
    const items = ['RED ZONE', '1ST & GOAL', 'RED ZONE', 'BALL ON THE 1']
    ctx.textBaseline = 'middle'
    ctx.font = font('display', h * 0.6, 800, true)
    const gap = h * 1.1
    const widths = items.map(t => ctx.measureText(t).width + t.length * h * 0.6 * 0.05)
    const total = widths.reduce((a, b) => a + b + gap, 0)
    ctx.save()
    ctx.scale(w / total, 1)
    let x = 0
    items.forEach((t, i) => {
      ctx.fillStyle = RED
      ctx.save()
      ctx.translate(x + gap / 2, h / 2)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-h * 0.09, -h * 0.09, h * 0.18, h * 0.18)
      ctx.restore()
      ctx.fillStyle = i % 2 ? '#f3e6e4' : RED
      trackedText(ctx, t, x + gap, h * 0.54, 0.05, 'left')
      x += widths[i] + gap
    })
    ctx.restore()
    c.tex.needsUpdate = true
  }
  onFonts(draw)
  c.tex.wrapS = THREE.RepeatWrapping
  return c.tex
}
