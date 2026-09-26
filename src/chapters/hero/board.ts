import { BOARD_ASPECT, drawBoardBase, dotMatrix } from '../../kit/board'
import { PALETTE } from '../../kit/field'
import { canvasTexture, drawMark, font, onFonts, trackedText } from '../../kit/type'

/*
 * The hero's video-board graphic: the network's kickoff card.
 *
 *   [KICKOFF]                                           (house title tab)
 *   (mark) HARK          VS.          THE INTERNET
 *                  Q1 · 15:00   (LED dot matrix)
 *
 * Decorative broadcast dressing only (no claims). Drawn once, and again when
 * the fonts arrive. The board is ~1/3 of the screen at most, so 1280 px wide
 * is plenty (768 on phones).
 */
export function kickoffBoard(mobile: boolean) {
  const W = mobile ? 768 : 1280
  const H = Math.round(W / BOARD_ASPECT)
  const c = canvasTexture(W, H, { mips: true, aniso: 4 })
  const draw = () => {
    const { ctx } = c
    ctx.clearRect(0, 0, W, H)
    drawBoardBase(ctx, W, H, 'KICKOFF')

    // matchup row
    const cy = H * 0.47
    const big = H * 0.22
    ctx.textBaseline = 'middle'
    ctx.font = font('display', big, 800, true)
    const ms = big * 1.05
    const left = W * 0.06
    drawMark(ctx, left, cy - ms / 2 - H * 0.01, ms, '#ffffff', PALETTE.yellow)
    ctx.fillStyle = '#ffffff'
    const hw = trackedText(ctx, 'HARK', left + ms * 1.12, cy, 0.01, 'left')
    ctx.font = font('display', big, 800, true)
    const iw = trackedText(ctx, 'THE INTERNET', W * 0.94, cy, 0.01, 'right')
    // VS. sits centred in the gap between the two names
    const gapL = left + ms * 1.12 + hw
    const gapR = W * 0.94 - iw
    ctx.fillStyle = PALETTE.yellow
    ctx.font = font('display', H * 0.12, 800, true)
    trackedText(ctx, 'VS.', (gapL + gapR) / 2, cy + H * 0.01, 0.04, 'center')

    // a hairline under the matchup
    ctx.fillStyle = 'rgba(243,244,238,0.22)'
    ctx.fillRect(W * 0.07, H * 0.66, W * 0.86, Math.max(1, H * 0.006))

    // the game clock in LED dots
    const cell = H * 0.0105
    dotMatrix(ctx, 'Q1  15:00', W * 0.5, H * 0.69, cell, PALETTE.yellow, { rows: 17, align: 'center', face: 'mono', weight: 700 })

    c.tex.needsUpdate = true
  }
  onFonts(draw)
  return c.tex
}
