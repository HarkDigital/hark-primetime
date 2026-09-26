import * as THREE from 'three'
import type { CameraPose, Chapter, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, TESTIMONIALS } from '../../content'
import { clamp, remap, smoothstep } from '../../core/math'
import { beat } from '../common'
import { isPortrait } from '../../kit/cams'
import { fontsReady } from '../../kit/type'
import { whenRevealed } from '../../kit/images'
import { nextFrame } from '../../core/yield'
import { SWEEP, blankImage, buildStunt, markImage, nameImage, type Stunt, type StuntGrid } from './stunt'
import './voices.css'

/*
 * VOICES — "The Crowd". We listen. They talk.
 *
 * A section of the lower bowl on the visitors' side, straight across from the
 * home broadcast camera, holds up a CARD STUNT: ~4k coloured cards that flip,
 * section-wide, to spell each client's company while the fan-cam lower third
 * carries the quote.
 *
 *   0.00–0.08  INTRO  eyebrow + "We listen. They talk."; the cards flip from
 *              blank to the Hark mark (centre-out); phones glimmer
 *   0.08–0.94  EIGHT VOICES, one per beat: the cards flip to the company
 *              (sweeping across the section, done by 26% of the beat) with a
 *              stadium wave riding along above them; the quote card wipes in
 *              once the name has formed and holds for the rest of the beat.
 *              Four camera set-ups, two voices each (home high push, a low
 *              angle from the field, a reverse from the west end, home again)
 *   0.94–1.00  OUT    cards flip back to the mark, the camera pulls back
 *
 * Everything derives from `local`; the only state is which FROM/TO pair is in
 * the card attributes (rewritten when it changes) and which quote the DOM card
 * holds (swapped while the card is out).
 */

const A = 0.08
const B = 0.94
const N = TESTIMONIALS.length
const SPAN = (B - A) / N
/** a beat's flip completes by this phase */
const FLIP_END = 0.26
/** the quote card shows over this part of each beat */
const CARD_IN = 0.17
const CARD_OUT = 0.965

type V3 = readonly [number, number, number]
interface Shot {
  /** beat coordinate range, x = (local − A) / SPAN */
  x0: number
  x1: number
  /** camera start → end over the shot: landscape, and far (portrait / a phone on its side) */
  L: readonly [V3, V3]
  P: readonly [V3, V3]
}

/* Camera set-ups. The section is framed by fit() below — these only place the
   camera; the aim and the lens follow from the section's corners. Portrait
   set-ups sit high (the lens has to fit 112 yd of section across a narrow
   frame) and keep ≥ 15 yd clear of the light-tower heads (y 86, z ±104,
   x −60/0/60, 20 yd wide). */
const SHOTS: Shot[] = [
  // intro + voices 1–2: the high home-side broadcast camera, a slow push
  { x0: -0.8, x1: 2, L: [[0, 31, 72], [0, 25, 56]], P: [[0, 74, 92], [0, 68, 86]] },
  // voices 3–4: a low angle from the field (portrait: from the home-west stands)
  { x0: 2, x1: 4, L: [[-18, 8.5, 32], [-8, 7, 27]], P: [[-34, 72, 98], [-24, 68, 94]] },
  // voices 5–6: the reverse from the west end of the section
  { x0: 4, x1: 6, L: [[-72, 26, 30], [-64, 22, 26]], P: [[-78, 84, 86], [-72, 80, 80]] },
  // voices 7–8: back to the home side from the west 30, trucking toward midfield
  { x0: 6, x1: 8, L: [[-30, 25, 60], [-10, 22, 52]], P: [[-34, 78, 96], [-18, 74, 90]] },
  // out: pull back and up
  { x0: 8, x1: 8.6, L: [[0, 27, 58], [0, 38, 82]], P: [[0, 70, 88], [0, 100, 80]] },
]
/** a set-up change eases over this much of the beat before / after its boundary */
const BLEND_IN = 0.55
const BLEND_OUT = 0.4

export default function create(): Chapter {
  const group = new THREE.Group()
  const B0 = beat(0, N, A, B)

  let stunt: Stunt
  let grid: StuntGrid
  let blank: Uint8Array
  let mark: Uint8Array
  const names: (Uint8Array | null)[] = TESTIMONIALS.map(() => null)
  /** bumps when a picture arrives so the attributes get rewritten */
  let version = 0
  let pairKey = -1

  let scrim: HTMLElement, intro: HTMLElement, introTitle: HTMLElement
  let card: HTMLElement, quote: HTMLElement, who: HTMLElement, count: HTMLElement
  let shown = -1
  let cardIn = false
  let outAt = -1e9
  let rm = false

  // camera scratch (no per-frame allocation)
  const pA = new THREE.Vector3()
  const pB = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const d = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  /** picture ids: −2 blank, −1 the mark, 0..7 a company */
  const img = (i: number) => (i === -2 ? blank : i < 0 ? mark : (names[i] ?? blank))

  function fillCard(i: number) {
    const t = TESTIMONIALS[i]
    quote.textContent = `“${t.quote}”`
    who.replaceChildren()
    el('span', 'vo-name', t.name, who)
    who.append(' · ')
    el('span', 'vo-co', t.company, who)
    count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`
  }

  function setCard(on: boolean) {
    if (cardIn !== on) {
      cardIn = on
      card.classList.toggle('is-in', on)
    }
  }

  function shotPos(s: Shot, x: number, far: boolean, out: THREE.Vector3) {
    const [a, b] = far ? s.P : s.L
    const t = clamp((x - s.x0) / (s.x1 - s.x0))
    const k = t * t * (3 - 2 * t)
    return out.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)
  }

  /** frame the whole section from `pos`: the lens fits its width, the aim places it */
  /**
   * `card` 0..1: how much room to leave for the quote card — the section sits
   * nearer the middle in the intro/out, in the upper-middle band while the
   * lower third is up (the chrome owns the top band either way).
   */
  function fit(out: CameraPose, pos: THREE.Vector3, frame: Frame, portrait: boolean, card: number) {
    const aspect = frame.width / Math.max(1, frame.height)
    // a phone on its side has no room above the card: the section goes right
    const short = !portrait && frame.height < 520
    const fill = portrait ? 0.97 : short ? 0.45 : 0.9
    const xOff = portrait ? 0 : short ? 0.5 : 0.02
    const yOff = portrait ? 0.08 + 0.17 * card : short ? 0.02 : 0.1 + 0.1 * card
    const top = portrait ? 0.64 : short ? 0.5 : 0.7
    const bottom = portrait ? -0.08 : short ? -0.46 : -0.3
    let fov = 40
    fwd.subVectors(stunt.center, pos).normalize()
    // re-aim a few times: the tangent-space estimate is only first order
    for (let it = 0; it < 3; it++) {
      right.crossVectors(fwd, UP).normalize()
      up.crossVectors(right, fwd)
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const k of stunt.corners) {
        d.subVectors(k, pos)
        const z = Math.max(1e-3, d.dot(fwd))
        const x = d.dot(right) / z
        const y = d.dot(up) / z
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
      let tanH = (x1 - x0) / (2 * fill)
      let tanV = Math.max(tanH / aspect, (y1 - y0) / 2 / Math.min(top - yOff, yOff - bottom))
      fov = clamp(2 * Math.atan(tanV) * THREE.MathUtils.RAD2DEG, portrait ? 30 : 20, portrait ? 84 : 60)
      tanV = Math.tan((fov * THREE.MathUtils.DEG2RAD) / 2)
      tanH = tanV * aspect
      const cx = (x0 + x1) / 2 - xOff * tanH
      const cy = (y0 + y1) / 2 - yOff * tanV
      fwd.addScaledVector(right, cx).addScaledVector(up, cy).normalize()
    }
    out.position.copy(pos)
    out.target.copy(pos).addScaledVector(fwd, 60)
    out.fov = fov
    out.roll = 0
  }

  return {
    id: 'voices',
    group,
    anchors: B0.centers,
    async init(ctx) {
      rm = ctx.reducedMotion
      grid = ctx.mobile
        ? { cols: 112, rows: 30, x0: -56, x1: 56, v0: 0.03, v1: 0.97 }
        : { cols: 140, rows: 34, x0: -56, x1: 56, v0: 0.015, v1: 0.985 }
      stunt = buildStunt(grid)
      group.add(stunt.mesh)
      blank = blankImage(grid)
      mark = markImage(grid)
      stunt.setPair(blank, mark)

      // DOM: the intro header and the fan-cam quote card (a lower third)
      scrim = el('div', 'vo-scrim', undefined, ctx.stage)
      intro = el('div', 'vo-intro', undefined, ctx.stage)
      el('p', 'hud-eyebrow', SECTIONS.voices.eyebrow, intro)
      introTitle = rise(el('h2', 'hud-h2 vo-title', undefined, intro), 'We listen. <em>They talk.</em>')

      card = el('figure', 'vo-card hud-panel', undefined, ctx.stage)
      const meta = el('div', 'vo-meta', undefined, card)
      el('span', 'vo-tag', 'Fan cam', meta)
      count = el('span', 'hud-label vo-count', '', meta)
      quote = el('blockquote', 'hud-quote vo-quote', '', card)
      who = el('figcaption', 'hud-label vo-who', '', card)
      fillCard(0)

      // the company names need the display face: rasterise them in idle
      // slices once the site has revealed and the fonts are in
      whenRevealed()
        .then(() => fontsReady())
        .then(async () => {
          for (let i = 0; i < N; i++) {
            await nextFrame()
            names[i] = nameImage(grid, TESTIMONIALS[i].company)
            version++
          }
        })
        .catch(() => {})
    },

    update(local, frame, ctx) {
      const W = ctx.world.params
      const reduced = frame.reducedMotion || rm
      // the beat (inline: no per-frame allocation)
      const x = (local - A) / SPAN
      const idx = clamp(Math.floor(x), 0, N - 1)
      const phase = clamp(x - idx)
      const active = local >= A && local <= B

      // ---- which picture the cards hold, and how far through the flip ----
      let from: number
      let to: number
      let flip: number
      let pattern: number
      if (local < A) {
        from = -2
        to = -1
        flip = reduced ? remap(local, 0.03, 0.05) : remap(local, 0.018, 0.064)
        pattern = SWEEP.center
      } else if (local <= B) {
        from = idx - 1
        to = idx
        flip = reduced ? remap(phase, 0.03, 0.14) : remap(phase, 0, FLIP_END)
        pattern = idx % 2 === 0 ? SWEEP.ltr : SWEEP.rtl
      } else {
        from = N - 1
        to = -1
        flip = reduced ? remap(local, 0.945, 0.96) : remap(local, 0.94, 0.978)
        pattern = SWEEP.center
      }
      const key = (from + 3) * 100 + (to + 3) + version * 10000
      if (key !== pairKey) {
        pairKey = key
        stunt.setPair(img(from), img(to))
      }
      const U = stunt.uniforms
      U.uFlip.value = flip
      U.uPattern.value = pattern
      U.uRM.value = reduced ? 1 : 0
      U.uIdle.value = reduced || frame.still ? 0 : 1

      // ---- the stadium: phones in the intro, a wave riding with each flip ----
      W.phones = 0.18 + 0.32 * (1 - smoothstep(0.06, 0.14, local))
      // one lap per voice, crossing the visitors' side (u 0.62–0.88) with the
      // flip and turning round on the home side (u 0.25, behind every camera),
      // so it never switches on or off in view
      W.wave = -1
      if (!reduced && x >= -0.37 && x < N - 0.37) {
        const k = clamp(Math.floor(x + 0.37), 0, N - 1)
        const s = 0.75 + (x - k - 0.13)
        const u = k % 2 === 0 ? s : 1.5 - s
        W.wave = ((u % 1) + 1) % 1
      }

      // ---- copy ----
      const iv = 1 - smoothstep(0.086, 0.104, local)
      reveal(intro, iv)
      reveal(scrim, iv * smoothstep(0.0, 0.02, local), 0)
      setRise(introTitle, local > 0.015 && local < 0.095)

      const want = active && phase >= CARD_IN && phase <= CARD_OUT ? idx : -1
      const now = performance.now()
      if (want === shown) setCard(want >= 0)
      else if (cardIn) {
        setCard(false)
        outAt = now
      } else if (reduced || now - outAt > 260) {
        if (want >= 0) {
          fillCard(want)
          setCard(true)
        }
        shown = want
      }
    },

    camera(local, frame, out) {
      const portrait = isPortrait(frame)
      // narrow frames need the far set-ups: the lens has to take in 112 yd of section
      const far = portrait || frame.height < 520
      const x = (local - A) / SPAN
      let s = SHOTS.length - 1
      for (let i = 0; i < SHOTS.length; i++) {
        if (x < SHOTS[i].x1) {
          s = i
          break
        }
      }
      const shot = SHOTS[s]
      shotPos(shot, x, far, pA)
      // ease across the cut between set-ups: a gentle dolly, never a whip
      const next = SHOTS[s + 1]
      const prev = SHOTS[s - 1]
      if (next && x > shot.x1 - BLEND_IN) {
        const t = smoothstep(shot.x1 - BLEND_IN, shot.x1 + BLEND_OUT, x)
        pA.lerp(shotPos(next, x, far, pB), t)
      } else if (prev && x < shot.x0 + BLEND_OUT) {
        const t = smoothstep(shot.x0 - BLEND_IN, shot.x0 + BLEND_OUT, x)
        pA.lerp(shotPos(prev, x, far, pB), 1 - t)
      }
      const card = smoothstep(0.072, 0.11, local) * (1 - smoothstep(0.93, 0.97, local))
      fit(out, pA, frame, portrait, card)
      out.parallax = rm ? 0 : 1.2
    },
  }
}
