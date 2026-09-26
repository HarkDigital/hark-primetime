import * as THREE from 'three'
import { boardCanvas, drawBoardBase } from '../../kit/board'
import { PALETTE } from '../../kit/field'
import { canvasTexture, drawMark, font, onFonts, trackedText } from '../../kit/type'
import { BRAND } from '../../content'
import { ringLength, TIERS } from '../../world/bowl'

/*
 * Touchdown's video-board and ribbon graphics. Each canvas is drawn once (and
 * again when the fonts land), never per frame:
 *
 *   touchdownBoard   TOUCHDOWN on a first-down-yellow slash, HARK.DIGITAL in LEDs
 *   helloBoard       "SAY HELLO" tab, the email big, the locale in LEDs
 *   finalBoard       a FINAL block, the mark + HARK.DIGITAL, THANKS FOR LISTENING
 *   ribbonTexture    a looping LED-ribbon strip of items (+ the repeat in yards
 *                    that keeps its lettering at the right aspect)
 *
 * All decorative: no scores or numbers are claimed.
 */

/** A slanted parallelogram (the network package's slash). */
function slash(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lean: number) {
  ctx.beginPath()
  ctx.moveTo(x + lean, y)
  ctx.lineTo(x + w + lean, y)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.closePath()
  ctx.fill()
}

/** Largest font size (px) at which `text` fits `maxW` (display face). */
function fitSize(ctx: CanvasRenderingContext2D, text: string, px: number, maxW: number, tracking = 0) {
  ctx.font = font('display', px, 800, true)
  const w = ctx.measureText(text).width + text.length * px * tracking
  return w > maxW ? Math.floor((px * maxW) / w) : px
}

export function touchdownBoard(mobile: boolean) {
  const b = boardCanvas(mobile)
  const { ctx, W, H } = b
  const draw = () => {
    drawBoardBase(ctx, W, H, '')
    // speed stripes behind the slash
    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    for (let i = 0; i < 5; i++) slash(ctx, W * (0.02 + i * 0.035), H * 0.16, W * 0.012, H * 0.62, H * 0.18)
    ctx.restore()
    // the yellow slash + TOUCHDOWN
    ctx.fillStyle = PALETTE.yellow
    slash(ctx, W * 0.07, H * 0.17, W * 0.84, H * 0.5, H * 0.14)
    ctx.fillStyle = PALETTE.navyDeep
    slash(ctx, W * 0.07, H * 0.635, W * 0.84, H * 0.035, -H * 0.01)
    const px = fitSize(ctx, 'TOUCHDOWN', H * 0.46, W * 0.76, 0.02)
    ctx.font = font('display', px, 800, true)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = PALETTE.navyDeep
    trackedText(ctx, 'TOUCHDOWN', W * 0.5 + H * 0.06, H * 0.43, 0.02, 'center')
    // HARK.DIGITAL in LEDs
    ctx.fillStyle = '#ffffff'
    ctx.font = font('display', H * 0.17, 800, true)
    trackedText(ctx, 'HARK.DIGITAL', W * 0.5, H * 0.83, 0.04, 'center')
    b.tex.needsUpdate = true
  }
  onFonts(draw)
  return b.tex
}

export function helloBoard(mobile: boolean) {
  const b = boardCanvas(mobile)
  const { ctx, W, H } = b
  const draw = () => {
    drawBoardBase(ctx, W, H, 'SAY HELLO')
    const mail = BRAND.email.toUpperCase()
    const px = fitSize(ctx, mail, H * 0.3, W * 0.8, 0.01)
    ctx.font = font('display', px, 800, true)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    trackedText(ctx, mail, W * 0.5, H * 0.46, 0.01, 'center')
    // underline in first-down yellow
    ctx.fillStyle = PALETTE.yellow
    slash(ctx, W * 0.14, H * 0.6, W * 0.72, H * 0.022, H * 0.01)
    const loc = BRAND.locale.toUpperCase()
    ctx.fillStyle = PALETTE.yellow
    ctx.font = font('mono', H * 0.075, 600)
    trackedText(ctx, loc, W * 0.5, H * 0.75, 0.14, 'center')
    b.tex.needsUpdate = true
  }
  onFonts(draw)
  return b.tex
}

export function finalBoard(mobile: boolean) {
  const b = boardCanvas(mobile)
  const { ctx, W, H } = b
  const draw = () => {
    drawBoardBase(ctx, W, H, '')
    // FINAL block
    ctx.fillStyle = PALETTE.yellow
    slash(ctx, W * 0.06, H * 0.2, W * 0.3, H * 0.4, H * 0.1)
    ctx.fillStyle = PALETTE.navyDeep
    ctx.textBaseline = 'middle'
    const fpx = fitSize(ctx, 'FINAL', H * 0.34, W * 0.24, 0.02)
    ctx.font = font('display', fpx, 800, true)
    trackedText(ctx, 'FINAL', W * 0.21 + H * 0.05, H * 0.41, 0.02, 'center')
    // the mark + HARK.DIGITAL
    const ms = H * 0.34
    drawMark(ctx, W * 0.41, H * 0.23, ms, '#ffffff', PALETTE.yellow)
    const px = fitSize(ctx, 'HARK.DIGITAL', H * 0.26, W * 0.4, 0.01)
    ctx.font = font('display', px, 800, true)
    ctx.fillStyle = '#ffffff'
    trackedText(ctx, 'HARK.DIGITAL', W * 0.41 + ms * 1.06, H * 0.41, 0.01, 'left')
    // sign-off in LEDs
    ctx.fillStyle = PALETTE.yellow
    const tpx = fitSize(ctx, 'THANKS FOR LISTENING', H * 0.15, W * 0.62, 0.06)
    ctx.font = font('display', tpx, 800, true)
    trackedText(ctx, 'THANKS FOR LISTENING', W * 0.5, H * 0.79, 0.06, 'center')
    b.tex.needsUpdate = true
  }
  onFonts(draw)
  return b.tex
}

/**
 * A ribbon strip: items separated by yellow diamonds, alternating yellow and
 * chalk. Returns the texture and the ribbon repeat (yards) that keeps the
 * lettering's aspect (the ribbon is 3 yd tall).
 */
export function ribbonTexture(mobile: boolean, items: string[]) {
  const h = mobile ? 64 : 128
  const c = canvasTexture(mobile ? 1024 : 2048, h, { mips: true })
  c.tex.wrapS = THREE.RepeatWrapping
  const out = { tex: c.tex, repeat: 120 }
  const draw = () => {
    const { ctx, canvas } = c
    const w = canvas.width
    ctx.fillStyle = PALETTE.navyDeep
    ctx.fillRect(0, 0, w, h)
    ctx.textBaseline = 'middle'
    ctx.font = font('display', h * 0.6, 800, true)
    const gap = h * 1.2
    const widths = items.map(t => ctx.measureText(t).width + t.length * h * 0.6 * 0.04)
    const total = widths.reduce((a, b) => a + b + gap, 0)
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
    // the ribbon is 3 yd tall: one repeat covers total/h * 3 yards, rounded
    // so a whole number of repeats wraps the bowl (no seam under the board)
    const around = ringLength(TIERS.ribbon.d)
    out.repeat = around / Math.max(1, Math.round(around / ((total / h) * 3)))
    c.tex.needsUpdate = true
  }
  onFonts(draw)
  return out
}
