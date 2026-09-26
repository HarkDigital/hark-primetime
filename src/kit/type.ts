import * as THREE from 'three'
import { MARK_PATHS } from '../ui/mark'

/*
 * Broadcast type for canvas-drawn signs (end zone paint, LED boards, jersey
 * numbers, telestrator labels). The DOM uses the same faces via base.css.
 *
 *   DISPLAY  Barlow Condensed 800 italic — the network graphics package
 *   SANS     Barlow 500/600              — body copy
 *   MONO     Chivo Mono                  — clocks, stats, down & distance
 *
 * Canvas text needs the face loaded before drawing: draw once with the
 * fallback, then redraw in onFonts(). Safari has no ctx.letterSpacing, so
 * tracking is done by drawing glyph by glyph (trackedText).
 */
export const FONTS = {
  display: '"Barlow Condensed", "Arial Narrow", sans-serif',
  sans: '"Barlow", system-ui, sans-serif',
  mono: '"Chivo Mono Variable", ui-monospace, monospace',
}

/** CSS font shorthand for canvas: font('display', 120, 800, true) */
export function font(face: keyof typeof FONTS, px: number, weight = 700, italic = false) {
  return `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${FONTS[face]}`
}

let fontsPromise: Promise<void> | null = null
/** Resolves once the canvas faces are loaded (or after 3 s, whichever first). */
export function fontsReady(): Promise<void> {
  if (fontsPromise) return fontsPromise
  const want = [
    '800 italic 64px "Barlow Condensed"',
    '700 64px "Barlow Condensed"',
    '800 64px "Barlow Condensed"',
    '600 64px "Barlow"',
    '500 64px "Chivo Mono Variable"',
  ]
  const load = document.fonts
    ? Promise.all(want.map(f => document.fonts.load(f).catch(() => []))).then(() => undefined)
    : Promise.resolve()
  fontsPromise = Promise.race([load, new Promise<void>(r => setTimeout(r, 3000))])
  return fontsPromise
}

/** Run `fn` now and again once the fonts are in (for canvases with text). */
export function onFonts(fn: () => void) {
  fn()
  fontsReady().then(fn)
}

/**
 * Draw text with manual tracking (em units), glyph by glyph. Returns the
 * drawn width. `align` is applied to the whole run.
 */
export function trackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking = 0,
  align: 'left' | 'center' | 'right' = 'left',
  mode: 'fill' | 'stroke' = 'fill',
) {
  const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '16')
  const gap = tracking * px
  const chars = [...text]
  const widths = chars.map(c => ctx.measureText(c).width)
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1)
  let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    if (mode === 'fill') ctx.fillText(c, cx, y)
    else ctx.strokeText(c, cx, y)
    cx += widths[i] + gap
  })
  ctx.textAlign = prev
  return total
}

/** A canvas + CanvasTexture pair (sRGB, mipmapped, anisotropic). */
export function canvasTexture(w: number, h: number, { mips = true, aniso = 8 } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = aniso
  tex.generateMipmaps = mips
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  return { canvas, ctx, tex }
}

/** Draw the Hark mark (loops + diamond) into a canvas square at (x, y) of size s. */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, loops = '#ffffff', diamond = '#ffd23f') {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s / 1889.9, s / 1889.9)
  ctx.fillStyle = loops
  for (const d of MARK_PATHS.loops) ctx.fill(new Path2D(d))
  ctx.fillStyle = diamond
  ctx.fill(new Path2D(MARK_PATHS.diamond))
  ctx.restore()
}

