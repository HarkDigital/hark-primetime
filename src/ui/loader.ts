import { holdInert, releaseInert } from './inert'
import { markSvg } from './mark'
import { MICROCOPY } from '../content'
import { calmUi } from './prefs'

/*
 * The PREGAME OPEN. A navy slate (the replay stinger's band, parked over the
 * whole frame, its speed lines leaning the same way): the Hark mark, the show
 * title "HARK PRIMETIME" in the network package (PRIMETIME on a slanted
 * yellow plate), a LIVE bug whose red dot blinks three times and then stays
 * lit, and the load as a DRIVE down a top-down football field: chalk yard
 * lines on navy, yard numbers, both end zones lettered like the stadium's
 * (DIGITAL west, HARK east), a yellow drive bar and a ball advancing from the
 * west goal line to the east one, over "PREGAME · 045%" and the spot of the
 * ball ("OWN 45" → "OPP 20" → "TOUCHDOWN").
 *
 * Exit: the slate sweeps off to the right exactly like the stinger's trailing
 * edge (yellow / white / thin yellow stripes on the band's slanted edge),
 * uncovering the hero. Reduced motion or Motion off: a plain fade.
 *
 * API used by main.ts: createLoader(root, { skip }) → { progress(0..1), finish() }.
 * Rules: shows at least ~1.2s, never hangs (finish() always resolves, every
 * wait is a bounded timer, never a rAF), the page behind is inert while it's
 * up, skip removes it at once (?nointro).
 */
const MIN_MS = 1200
/** the ball never covers the whole field faster than this (cached loads) */
const DRIVE_MS = 950
/** the touchdown beat before the exit */
const HOLD_MS = 240
const WIPE_MS = 640
const FADE_MS = 360

/* the field strip: 1 unit = 0.1 yd; end lines at 0 / 1200, goal lines at 100 / 1100 */
function fieldSvg() {
  const lines: string[] = []
  // five-yard lines (the goal lines are drawn bolder)
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = 100 + yd * 10
    const cls = yd === 0 || yd === 100 ? 'ld-f-goal' : yd % 10 === 0 ? 'ld-f-ten' : 'ld-f-five'
    lines.push(`<path class="${cls}" d="M${x} 0V200"/>`)
  }
  // single-yard ticks along both sidelines and the two hash rows
  const ticks: string[] = []
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue
    const x = 100 + yd * 10
    ticks.push(`M${x} 2v12M${x} 186v12M${x} 70v9M${x} 121v9`)
  }
  const nums: string[] = []
  for (let yd = 10; yd <= 90; yd += 10) {
    const n = yd <= 50 ? yd : 100 - yd
    const x = 100 + yd * 10
    nums.push(`<text x="${x}" y="176">${n}</text><text class="ld-f-far" x="${x}" y="52">${n}</text>`)
  }
  return `<svg class="ld-field-svg" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <rect class="ld-f-turf" width="1200" height="200"/>
    <rect class="ld-f-ez" width="100" height="200"/>
    <rect class="ld-f-ez" x="1100" width="100" height="200"/>
    <text class="ld-f-ezt" transform="translate(58 100) rotate(-90)">DIGITAL</text>
    <text class="ld-f-ezt" transform="translate(1142 100) rotate(90)">HARK</text>
    <path class="ld-f-tick" d="${ticks.join('')}"/>
    ${lines.join('')}
    <g class="ld-f-num">${nums.join('')}</g>
    <path class="ld-f-mid" d="M594 94l6 -6 6 6 -6 6z"/>
  </svg>`
}

/** a football seen from above: leather, a white stripe at each end, laces */
const BALL = `<svg class="ld-ball-svg" viewBox="0 0 44 26" aria-hidden="true" focusable="false">
  <path class="ld-ball-l" d="M2 13C8 3 36 3 42 13C36 23 8 23 2 13Z"/>
  <path class="ld-ball-s" d="M9.5 6.4v13.2M34.5 6.4v13.2"/>
  <path class="ld-ball-c" d="M15 13h14M17 10.4v5.2M20.3 10.4v5.2M23.6 10.4v5.2M26.9 10.4v5.2"/>
</svg>`

const spot = (yd: number) => {
  if (yd >= 99.5) return 'Touchdown'
  const y = Math.round(yd)
  if (y === 50) return 'Midfield'
  return y < 50 ? `Own ${Math.max(1, y)}` : `Opp ${100 - y}`
}

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  const start = performance.now()
  let target = 0
  let shown = -1
  let raf = 0
  let done = false

  if (skip) root.remove()
  else {
    root.innerHTML = `
      <div class="ld">
        <div class="ld-slate" aria-hidden="true"></div>
        <div class="ld-body">
          <p class="sr-only">Loading Hark Digital, Primetime concept</p>
          <div class="ld-head" aria-hidden="true">
            <p class="ld-live"><i></i>Live</p>
            <div class="ld-mark">${markSvg('ld-svg')}</div>
            <p class="ld-title"><span class="ld-t-a">Hark</span><span class="ld-t-b"><span>Primetime</span></span></p>
            <p class="ld-sub">${MICROCOPY.signalEyebrow}</p>
          </div>
          <div class="ld-drive" aria-hidden="true">
            <div class="ld-field">
              ${fieldSvg()}
              <div class="ld-run"><i class="ld-run-bar"></i><i class="ld-run-line"></i><span class="ld-ball">${BALL}</span></div>
            </div>
            <p class="ld-read"><span class="ld-read-a">Pregame · <b data-pct>000</b>%</span><span class="ld-read-b" data-spot>Own 1</span></p>
          </div>
        </div>
      </div>`
    if (calmUi()) root.classList.add('is-calm')
    holdInert('loader', [document.getElementById('track'), document.getElementById('stages'), document.getElementById('chrome')])
  }
  const run = root.querySelector<HTMLElement>('.ld-run')
  const pct = root.querySelector<HTMLElement>('[data-pct]')
  const spotEl = root.querySelector<HTMLElement>('[data-spot]')

  /** what the field shows: the real load, never faster than one DRIVE_MS drive */
  const paint = () => {
    raf = 0
    if (!run) return
    const byTime = Math.min(1, (performance.now() - start) / DRIVE_MS)
    const v = Math.min(target, byTime)
    if (Math.abs(v - shown) < 0.001) {
      if (!done && v < target) raf = requestAnimationFrame(paint)
      return
    }
    shown = v
    run.style.setProperty('--p', v.toFixed(4))
    if (pct) pct.textContent = String(Math.round(v * 100)).padStart(3, '0')
    if (spotEl) spotEl.textContent = spot(v * 100)
    if (!done && v < target) raf = requestAnimationFrame(paint)
  }
  const kick = () => {
    if (!raf && !skip) raf = requestAnimationFrame(paint)
  }

  return {
    progress(p: number) {
      const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
      if (v <= target) return
      target = v
      kick()
    },
    async finish(): Promise<void> {
      if (skip) return
      try {
        const wait = MIN_MS - (performance.now() - start)
        if (wait > 0) await new Promise(r => setTimeout(r, wait))
        // the drive ends in the end zone, then a beat on "TOUCHDOWN"
        target = 1
        cancelAnimationFrame(raf)
        paint()
        done = true
        root.classList.add('is-td')
        await new Promise(r => setTimeout(r, HOLD_MS))
        const calm = calmUi()
        root.classList.toggle('is-calm', calm)
        root.classList.add('is-out')
        // the page wakes as the slate starts to move, so the first Tab lands in it
        releaseInert('loader')
        await new Promise(r => setTimeout(r, calm ? FADE_MS : WIPE_MS))
      } catch {
        /* never hold the page hostage */
      } finally {
        done = true
        cancelAnimationFrame(raf)
        releaseInert('loader')
        root.remove()
      }
    },
  }
}
