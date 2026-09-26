import * as THREE from 'three'
import type { CameraPose, Chapter, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, WORK, workImage } from '../../content'
import { clamp, lerp, smoothstep } from '../../core/math'
import { beat } from '../common'
import { loadScreenshot, whenRevealed } from '../../kit/images'
import { BOARD } from '../../kit/board'
import { isPortrait, makePose, blendPose, type PoseLike } from '../../kit/cams'
import { SHOT_RECT, createBoardArt, createRibbon, type BoardState } from './graphics'
import { aim, angle, mixAngle, placeAt, fovFor, type Angle, type Region } from './shots'
import './work.css'

/*
 * HIGHLIGHTS (work) — the highlight reel on the video board.
 *
 *   0.00–0.10  INTRO. From the field at the west 30, low, looking east down
 *              the field at the board's HIGHLIGHTS open; "Built to be heard."
 *              wipes in on the left (top on portrait). A slow dolly, then a
 *              crash zoom into the first replay.
 *   0.10–0.84  SIX REPLAYS (beat()). The board plays each featured site
 *              (boardMain in SHOT_RECT, wiped in), the LED column names it,
 *              the lower third carries meta / name / blurb / tags / link.
 *              Each replay has its own broadcast angle; between them a
 *              whip-pan (post glitch smear) cuts to the next camera.
 *   0.85–0.97  "NINE MORE, ALL LIVE." The LED ribbon scrolls the other nine
 *              names while the camera tracks along the far-side fascia; the
 *              panel lists them + Say hello.
 *   0.97–1.00  whip out into the stinger.
 *
 * Screenshots: the first loads right away, the rest after the reveal,
 * decoded off the main thread (kit/images.ts). The board canvas is ONE canvas
 * redrawn only when the segment changes (≤ 3.5 swaps a second).
 */
const FEATURED = WORK.filter(w => w.featured)
const REST = WORK.filter(w => !w.featured)
const isPreview = (url: string) => /harktest\.com/.test(url)
const N = FEATURED.length

/** replay beats */
const A = 0.1
const B = 0.84
const SPAN = (B - A) / N
/** whip-pan half-window, in beat phase */
const WH = 0.06
/** the crash zoom from the intro into replay 01 ends here (beat-0 phase) */
const ZIN = 0.12
/** whip turn, radians, and the smear it carries */
const WHIP = 0.62
const GLITCH = 0.45
/** the nine: rest range, then out */
const OUT = 0.962

/** the board, and the centre of the screenshot slot on it (board uv → world: u runs −z → +z) */
const BOARD_C = BOARD.center.clone()
const SHOT_C = new THREE.Vector3(
  BOARD.center.x - 0.05,
  BOARD.center.y + (SHOT_RECT.y + SHOT_RECT.w / 2 - 0.5) * BOARD.height,
  (SHOT_RECT.x + SHOT_RECT.z / 2 - 0.5) * BOARD.width,
)
const SHOT_W = SHOT_RECT.z * BOARD.width
const SHOT_AR = (SHOT_RECT.z * BOARD.width) / (SHOT_RECT.w * BOARD.height)

/*
 * Six broadcast angles (start → end of each replay's rest): az/el off the
 * board's normal, lens (16:10 vertical fov), subject size k, roll.
 */
const SHOTS: [Angle, Angle][] = [
  // 01 wide from midfield: a long lens down the field, slow push
  [angle(4, -16, 17, 0.84), angle(1.5, -15, 15.5, 0.93)],
  // 02 low in the east end zone, looking up at the board (a touch of dutch)
  [angle(-22, -34, 30, 0.86, -0.045), angle(-17, -30, 28, 0.93, -0.025)],
  // 03 high on the home sideline, the board seen down the stands
  [angle(44, 11, 30, 0.8), angle(38, 8, 28, 0.87)],
  // 04 the money shot: square-on and tight, the LED dots show
  [angle(4, 3, 30, 0.97), angle(1, 1.5, 28, 1)],
  // 05 the upper deck corner on the far side, a long lens down across the bowl
  [angle(-34, 12, 18, 0.8), angle(-29, 10, 17, 0.86)],
  // 06 skycam push: a wide lens from high over the field, diving in
  [angle(14, 24, 42, 0.74), angle(8, 15, 38, 0.97)],
]

/** intro dolly: camera positions (west 30 → toward midfield) framing the whole board */
const INTRO_FROM = new THREE.Vector3(-32, 4.2, 15)
const INTRO_TO = new THREE.Vector3(-13, 7, 9)

/** the far-side ribbon (−z) the nine-more shot tracks along */
const RIBBON_Z = -(38 + 30.5)
const RIBBON_Y = 21

export default function create(): Chapter {
  const group = new THREE.Group()
  const shotTex: (THREE.Texture | null)[] = FEATURED.map(() => null)
  let art: ReturnType<typeof createBoardArt>
  let ribbon: ReturnType<typeof createRibbon>
  let lastSwap = -1e9

  // DOM
  let intro: HTMLElement, introTitle: HTMLElement
  let card: HTMLElement, name: HTMLElement, meta: HTMLElement, blurb: HTMLElement, tags: HTMLElement, visit: HTMLAnchorElement
  let scrub: HTMLElement
  let more: HTMLElement, probe: HTMLElement
  let shown = -1
  let scrubV = -1

  // measured layout (px), refreshed on resize / content change — never per frame
  const lay = { safeT: 90, safeB: 90, gutter: 40, introR: 600, introB: 260, cardR: 520, cardT: 520, moreR: 560, moreT: 460 }
  const measure = () => {
    const vh = window.innerHeight
    const p = probe.getBoundingClientRect()
    lay.safeT = p.top
    lay.safeB = vh - p.bottom
    lay.gutter = p.left
    const i = intro.getBoundingClientRect()
    lay.introR = i.right
    lay.introB = i.bottom
    const c = card.getBoundingClientRect()
    lay.cardR = c.right
    lay.cardT = c.top
    const m = more.getBoundingClientRect()
    lay.moreR = m.right
    lay.moreT = m.top
  }

  // scratch (no per-frame allocation)
  const poseA = makePose()
  const poseB = makePose()
  const ang = angle(0, 0, 30, 1)
  const reg: Region = { x0: 0, x1: 0, y0: 0, y1: 0 }
  const dir = new THREE.Vector3()
  const subj = new THREE.Vector3()

  /** the free screen region beside/above the lower third */
  function cardRegion(frame: Frame, out: Region) {
    const W = frame.width
    const H = frame.height
    const g = lay.gutter
    if (isPortrait(frame)) {
      out.x0 = g
      out.x1 = W - g
      out.y0 = lay.safeT + 8
      // clear of the REPLAY bug riding on top of the plate
      out.y1 = Math.max(out.y0 + 80, lay.cardT - 34)
    } else {
      out.x0 = Math.min(W * 0.62, lay.cardR + 28)
      out.x1 = W - g
      out.y0 = lay.safeT + 6
      out.y1 = H - lay.safeB - 6
    }
    return out
  }

  function introRegion(frame: Frame, out: Region) {
    const W = frame.width
    const H = frame.height
    const g = lay.gutter
    if (isPortrait(frame)) {
      out.x0 = g
      out.x1 = W - g
      out.y0 = lay.introB + 16
      out.y1 = Math.max(out.y0 + 80, lay.introB + (H - lay.safeB - lay.introB) * 0.62)
    } else {
      out.x0 = Math.min(W * 0.6, Math.max(W * 0.4, lay.introR + 28))
      out.x1 = W - g
      out.y0 = lay.safeT + 6
      out.y1 = H * 0.66
    }
    return out
  }

  /** replay i at rest-progress p (0..1) with a whip turn */
  function replayPose(i: number, p: number, frame: Frame, out: PoseLike & { roll?: number }, yaw = 0) {
    const [a, b] = SHOTS[i]
    const e = p * p * (3 - 2 * p) * 0.35 + p * 0.65
    mixAngle(a, b, e, ang)
    aim(out, SHOT_C, SHOT_W, SHOT_AR, ang, cardRegion(frame, reg), frame.width, frame.height, yaw)
  }

  /** the intro dolly toward the board at t (0..1): the lens adapts to hold the board's size */
  function introPose(t: number, frame: Frame, out: PoseLike & { roll?: number }) {
    const W = frame.width
    const H = frame.height
    const e = 1 - (1 - t) * (1 - t)
    const cam = subj.lerpVectors(INTRO_FROM, INTRO_TO, e)
    introRegion(frame, reg)
    const rw = (reg.x1 - reg.x0) / W
    const rh = (reg.y1 - reg.y0) / H
    const k = isPortrait(frame) ? lerp(0.8, 0.93, e) : lerp(0.66, 0.86, e)
    const wf = k * Math.min(rw, (rh * H * BOARD.width) / BOARD.height / W)
    dir.subVectors(cam, BOARD_C)
    const dist = dir.length()
    dir.divideScalar(dist)
    const cosAz = Math.abs(dir.x) / Math.hypot(dir.x, dir.z)
    const tanH = (BOARD.width * cosAz) / (2 * wf * dist)
    const fov = (2 * Math.atan(tanH / (W / H)) * 180) / Math.PI
    const cx = (reg.x0 + reg.x1) / 2 / W
    const cy = (reg.y0 + reg.y1) / 2 / H
    placeAt(out, BOARD_C, dir, dist, fov, 2 * cx - 1, 1 - 2 * cy, W / H, 0, true)
    out.roll = 0
  }

  /**
   * The nine-more tracking shot: low on the far sideline, looking west down
   * the far-side stands so the ribbon runs big across the right of the frame
   * and recedes behind the list; the camera drifts east as the names scroll.
   */
  function ninePose(t: number, frame: Frame, out: PoseLike & { roll?: number }, yaw = 0) {
    const W = frame.width
    const H = frame.height
    const portrait = isPortrait(frame)
    const x = lerp(20, 34, t)
    subj.set(x - (portrait ? 30 : 40), RIBBON_Y - 0.5, RIBBON_Z)
    const cam = dir.set(x, portrait ? 7 : 6, portrait ? -4 : -10)
    const d = cam.distanceTo(subj)
    cam.sub(subj).divideScalar(d)
    const fov = fovFor(portrait ? 30 : 34, W / H)
    // the ribbon runs above the list: middle of the band between the top chrome and the panel
    const cy = clamp(((lay.safeT + lay.moreT) / 2) / H, 0.22, portrait ? 0.4 : 0.42)
    placeAt(out, subj, cam, d, fov, portrait ? 0 : 0.12, 1 - 2 * cy, W / H, yaw, true)
    out.roll = 0
  }

  /** beat() without the per-call centres array (runs twice a frame) */
  const bt = { idx: 0, phase: 0 }
  function beatAt(local: number) {
    const i = Math.min(N - 1, Math.max(0, Math.floor((local - A) / SPAN)))
    bt.idx = i
    bt.phase = clamp((local - A - i * SPAN) / SPAN)
    return bt
  }

  /** signed whip position around the nearest cut (−1..1), or 0 outside a whip */
  function whipT(local: number) {
    for (let i = 1; i <= N; i++) {
      const bnd = A + i * SPAN
      const t = (local - bnd) / (WH * SPAN)
      if (t > -1 && t < 1) return t === 0 ? 1e-6 : t
    }
    return 0
  }

  return {
    id: 'work',
    group,
    // featured first, then the nine others (srContent / WORK order: featured are first in content.ts)
    anchors: [...beat(0, N, A, B).centers, ...REST.map(() => 0.9)],
    init(ctx) {
      const stage = ctx.stage
      probe = el('div', 'wk-probe', undefined, stage)

      intro = el('div', 'wk-intro', undefined, stage)
      el('p', 'hud-eyebrow', SECTIONS.work.eyebrow, intro)
      introTitle = rise(el('h2', 'hud-h2 wk-title', undefined, intro), 'Built to be <em>heard.</em>')

      card = el('div', 'wk-card hud-panel', undefined, stage)
      const bug = el('div', 'wk-bug', undefined, card)
      el('span', 'wk-bug-play', undefined, bug)
      el('span', '', 'Replay', bug)
      scrub = el('i', '', undefined, el('div', 'wk-scrub', undefined, card))
      meta = el('p', 'hud-label wk-meta', '', card)
      name = el('h3', 'hud-h2 wk-name', '', card)
      blurb = el('p', 'hud-body wk-blurb', '', card)
      const foot = el('div', 'wk-foot', undefined, card)
      tags = el('ul', 'hud-tags', undefined, foot)
      visit = el('a', 'hud-btn hud-btn--ghost wk-visit', '', foot)
      visit.target = '_blank'
      visit.rel = 'noopener'

      more = el('div', 'wk-more hud-panel', undefined, stage)
      el('p', 'hud-label wk-meta', `+ ${String(REST.length).padStart(2, '0')} · On the ribbon`, more)
      el('h3', 'hud-h2 wk-name', 'Nine more, all live.', more)
      const list = el('ul', 'wk-list', undefined, more)
      for (const w of REST) {
        const li = el('li', '', undefined, list)
        const a = el('a', '', `${w.name}\u00a0↗`, li)
        a.href = w.url
        a.target = '_blank'
        a.rel = 'noopener'
        el('span', '', w.industry, li)
      }
      const hello = el('button', 'hud-btn', 'Say hello', more)
      hello.type = 'button'
      hello.addEventListener('click', () => window.__hark?.land('contact'))

      // hidden until the first update places them
      reveal(intro, 0, 0)
      reveal(card, 0, 0)
      reveal(more, 0, 0)

      measure()
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => measure())
        for (const n of [intro, card, more, probe]) ro.observe(n)
      }
      window.addEventListener('resize', measure)

      art = createBoardArt(ctx.mobile, FEATURED)
      art.show('intro')
      ribbon = createRibbon(
        ctx.mobile,
        REST.map(w => w.name),
        'Nine more, all live.',
      )

      // first screenshot right away, the rest after the reveal (decoded off-thread)
      const width = ctx.mobile ? 1024 : 1280
      const load = (i: number) =>
        loadScreenshot(workImage(FEATURED[i].id), { width })
          .then(t => {
            t.anisotropy = 8
            // upload now (spread over the load), not on the frame the board first shows it
            ctx.renderer.initTexture(t)
            shotTex[i] = t
          })
          .catch(() => {})
      load(0)
      whenRevealed().then(async () => {
        for (let i = 1; i < N; i++) await load(i)
      })
    },

    update(local, frame, ctx) {
      const { world, post } = ctx
      const rm = frame.reducedMotion
      const b = beatAt(local)
      const inReplay = local >= A && local < B

      // ---- copy
      reveal(intro, 1 - smoothstep(0.094, 0.108, local), 0)
      setRise(introTitle, local > 0.012 && local < 0.104)
      reveal(card, inReplay ? smoothstep(0.05, 0.12, b.phase) * (1 - smoothstep(0.88, 0.94, b.phase)) : 0, 0)
      reveal(more, smoothstep(0.853, 0.872, local) * (1 - smoothstep(0.958, 0.972, local)), 0)
      if (inReplay && b.idx !== shown) {
        shown = b.idx
        const w = FEATURED[shown]
        meta.textContent = `${String(shown + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')} · ${w.industry}`
        name.textContent = w.name
        blurb.textContent = w.blurb
        tags.replaceChildren(...w.tags.map(t => Object.assign(document.createElement('li'), { className: 'hud-tag', textContent: t })))
        visit.href = w.url
        visit.textContent = isPreview(w.url) ? 'Preview site\u00a0↗' : 'Visit site\u00a0↗'
      }
      // the replay scrubber (quantised so it only touches the DOM when it moves)
      const sv = Math.round(clamp((b.phase - 0.06) / 0.86) * 200) / 200
      if (inReplay && sv !== scrubV) {
        scrubV = sv
        scrub.style.transform = `scaleX(${sv})`
      }

      // ---- the board: one canvas, swapped at most every 0.36 s, and each picture
      // wipes in over ≥ 0.3 s of real time — a fast scroll can't strobe the LEDs
      // (< 3 luminance changes a second); at rest both settle on the local value
      const want: BoardState = local < A ? 'intro' : b.idx
      const now = performance.now()
      if (art.state !== want && now - lastSwap > 360) {
        art.show(want)
        lastSwap = now
      }
      const paced = rm ? 1 : clamp((now - lastSwap) / 300)
      const p = world.params
      p.boardBg = art.tex
      p.boardLevel = 0.94
      const st = art.state
      if (typeof st === 'number') {
        const tex = shotTex[st]
        p.boardMain = tex
        p.boardRect.copy(SHOT_RECT)
        p.boardMainOn = tex ? 1 : 0
        const settled = st === want && local < B
        p.boardWipe = !settled ? 1 : rm ? (b.phase > 0.04 ? 1 : 0) : Math.min(smoothstep(0.03, 0.13, b.phase), paced)
      }
      // keep the LED picture under the bloom threshold, and the long lenses clear of haze
      if (local > A - 0.02 && local < B + 0.01) {
        post.params.bloomThreshold = 1.15
        p.haze = 0.55
        p.ribbonLevel = 0.4
      }

      // ---- the ribbon: the nine names from the whip on, scrolled by the scroll
      if (local >= B) {
        p.ribbon = ribbon.tex
        p.ribbonRepeat = ribbon.repeat
        p.ribbonScroll = 0.08 + (local - B) * 1.2
        p.ribbonLevel = 0.5
        p.phones = 0.35
        post.params.bloomThreshold = 1.1
      }

      // ---- whip-pan smear at every cut between angles, and the out — only
      // while the story is actually moving (parked mid-whip, the frame is clean)
      const wt = whipT(local)
      let g = wt ? GLITCH * (1 - smoothstep(0.1, 1, Math.abs(wt))) : 0
      g = Math.max(g, 0.42 * smoothstep(OUT, 1, local))
      post.params.glitch = rm ? 0 : g * smoothstep(0.03, 0.35, Math.abs(frame.velocity))
    },

    camera(local, frame, out: CameraPose) {
      const rm = frame.reducedMotion
      const b = beatAt(local)
      out.parallax = 0.35
      const zEnd = A + ZIN * SPAN
      const zStart = 0.093
      if (local < zStart) {
        introPose(local / zStart, frame, out)
        return
      }
      if (local < zEnd) {
        // crash zoom: the end of the dolly → replay 01's first frame
        introPose(1, frame, poseA)
        replayPose(0, 0, frame, poseB)
        const t = smoothstep(zStart, zEnd, local)
        blendPose(out, poseA, poseB, t * t * (3 - 2 * t))
        out.roll = 0
        return
      }
      if (local < B) {
        const i = b.idx
        const ph = b.phase
        const p0 = i === 0 ? ZIN : WH
        const p = clamp((ph - p0) / (1 - WH - p0))
        let yaw = 0
        if (!rm) {
          if (i > 0 && ph < WH) yaw = -WHIP * (1 - ph / WH) ** 2
          else if (ph > 1 - WH) yaw = WHIP * ((ph - (1 - WH)) / WH) ** 2
        }
        replayPose(i, p, frame, out, yaw)
        return
      }
      // the nine: whip in, track along the ribbon, whip out into the stinger
      const t = (local - B) / (OUT - B)
      let yaw = 0
      if (!rm) {
        const win = WH * SPAN
        if (local < B + win) yaw = -WHIP * (1 - (local - B) / win) ** 2
        else if (local > OUT) yaw = 0.9 * ((local - OUT) / (1 - OUT)) ** 2
      }
      ninePose(clamp(t), frame, out, yaw)
    },
  }
}
