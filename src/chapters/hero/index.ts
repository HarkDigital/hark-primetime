import * as THREE from 'three'
import type { Chapter, Frame } from '../../core/types'
import { el, reveal, rise, setRise } from '../../core/dom'
import { BRAND, MICROCOPY } from '../../content'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { createFootball, createTee } from '../../kit/props'
import { ArLine } from '../../kit/ar'
import { PALETTE, yardX } from '../../kit/field'
import { kickoffBoard } from './board'
import { SkyPath, type Key } from './path'
import { rimShell } from './rim'
import './hero.css'

/*
 * HERO — "Kickoff". The network open of a Sunday night game.
 *
 *   0.00–0.12  PREGAME   blimp shot of the whole bowl at night, two light banks
 *                        on; the rest switch on in turn as you scroll. Intro
 *                        lower third (eyebrow, manifesto, scroll hint).
 *   0.12–0.57  THE DIVE  the skycam dives over the home upper deck, between the
 *                        light towers, past the ribbon, glides low along the home
 *                        sideline, swings out over the Hark mark at midfield and
 *                        pulls back and down behind the ball (the whip smear
 *                        only when scrolling fast through the swing).
 *   0.57–0.70  SET       low behind the ball on its tee at the WEST 35, looking
 *                        east at the mark, the goal posts and the board (which
 *                        wipes to the kickoff card); the yellow line draws on.
 *   0.62–0.92  PAYOFF    h1 "Make the internet listen." + CTAs; slow push-in.
 *   0.915–1.0  THE KICK   the ball launches up and away, the camera tilts after it
 *                        into the replay stinger.
 *
 * Everything is a pure function of `local` (frame.time only drives the tiny
 * idle float, off under reduced motion / Motion off).
 */

const BALL_X = yardX(35)
const SCALE = 5
/** top of the tee stem (the ball's lower tip sits here) */
const TEE_TOP = 0.05 * SCALE
const HALF = 0.153 * SCALE
/** the ball leans back toward the kicker a little, like a real kickoff */
const LEAN = 0.2

const T_SET = 0.57
const T_KICK = 0.915

/*
 * Keys (see path.ts). Stadium: towers at x −60/0/60, z ±104, heads y 86;
 * home upper tier z 70.5→96 (y 26.5→48); ribbon z ≈ 68.5, y 19.5–22.5; lower
 * tier z 39.5→68 (y 2.2→19); home sideline z 26.7.
 */
const KEYS: Key[] = [
  // 0 PREGAME: blimp, high off the home-west corner, the far lit bank flaring
  { t: 0.0, p: [-192, 142, 142], q: [18, 2, -22], f: 38, pp: [-262, 150, 70], pq: [10, 36, -6], pf: 50 },
  // 1 the blimp creeps in while the intro reads
  { t: 0.12, p: [-176, 132, 134], q: [14, 2, -18], f: 38, pp: [-240, 140, 66], pq: [8, 30, -6], pf: 51 },
  // 2 in over the west-home corner of the upper deck, west of the west tower
  //   (tower heads stay out of frame: never a dark box up close)
  { t: 0.22, p: [-94, 88, 98], q: [-10, 0, -4], f: 46, pp: [-100, 92, 92], pq: [-12, 0, -4], pf: 64 },
  // 3 dropping past the ribbon and the suites onto the home straight
  { t: 0.29, p: [-52, 25, 62], q: [0, 2, -6], f: 48, pf: 66 },
  // 4 low on the home sideline
  { t: 0.36, p: [-27, 4.6, 33], q: [8, 1.2, -2], f: 44, pf: 62 },
  // 5 gliding east along the sideline toward midfield
  { t: 0.435, p: [-6, 3.4, 31], q: [18, 1, 0], f: 42, pf: 60 },
  // 6 swung out over the Hark mark at midfield (read from the home side)
  { t: 0.495, p: [3, 12, 13], q: [0, 0, -1], f: 46, pf: 62 },
  // 7 SET: behind the ball (written every frame from setPose)
  { t: T_SET, p: [BALL_X - 5, 1.4, -1], q: [BALL_X + 40, 4, -5], f: 38 },
]

export default function create(): Chapter {
  const group = new THREE.Group()
  const path = new SkyPath(KEYS)

  // ---- the ball on its tee at the west 35 (a stylised close-up: ×5) ----
  const tee = createTee()
  tee.scale.setScalar(SCALE)
  tee.position.set(BALL_X, 0, 0)
  const ballPivot = new THREE.Group() // at the tee cup; leans and flies
  const ball = createFootball()
  ball.scale.setScalar(SCALE)
  ball.rotation.set(0, 0, Math.PI / 2) // long axis up
  ball.position.y = HALF * 0.985
  // chalk-white laces (the kit's lace material is this instance's own)
  const lace = (ball.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial
  lace.emissive.set('#34332e')
  // the floodlights rim the leather (unlit shell on the ball's own body geometry)
  const rim = rimShell((ball.children[0] as THREE.Mesh).geometry)
  ball.add(rim.mesh)
  const spin = new THREE.Group() // the laces face the camera, a touch off-axis
  spin.rotation.y = -0.22
  spin.add(ball)
  ballPivot.add(spin)
  group.add(tee, ballPivot)

  // ---- broadcast AR: the first-down-yellow line under the ball ----
  const line = new ArLine({ color: PALETTE.yellow, width: 0.32, glow: 1.15 })
  group.add(line.mesh)

  const board = { tex: null as THREE.Texture | null }

  // pose scratch (no per-frame allocation)
  const endP = new THREE.Vector3()
  const endQ = new THREE.Vector3()
  const kickP = new THREE.Vector3()
  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  let intro: HTMLElement
  let scrim: HTMLElement
  let payoff: HTMLElement
  let kicker: HTMLElement
  let title: HTMLElement
  let ctas: HTMLElement
  let reduced = false

  /** 0 landscape … 1 portrait (by aspect, so 768×1024 sits in between) */
  const portraitBlend = (f: Frame) => 1 - smoothstep(0.62, 1.2, f.width / Math.max(1, f.height))

  /** where the ball is at this local (on the tee until the kick) */
  function placeBall(local: number) {
    const k = segment(local, T_KICK, 1)
    // lifts visibly off the tee, then carries up and away downfield
    ballPivot.position.set(BALL_X + 32 * Math.pow(k, 1.35), TEE_TOP + 18 * Math.pow(k, 1.1), 0)
    // end over end, the nose rotating back toward the kicker
    ballPivot.rotation.set(0, 0, LEAN + k * 4.6 * Math.PI)
    return k
  }

  /** The set shot behind the ball: push 0..1 is the slow push-in. Returns the fov. */
  function setPose(push: number, a: number, outP: THREE.Vector3, outQ: THREE.Vector3, aspect: number, short: number) {
    // landscape: a touch to the far (−z) side so the ball sits right of centre
    // and the field runs away beside it. Portrait: lower and a little to the
    // side too, so the uprights stand clear of the ball, which sits above the
    // copy at the bottom.
    const back = lerp(lerp(8.4, 8.6, a), lerp(7.2, 7.5, a), push)
    const side = lerp(-0.9, -0.7, a)
    // short landscape screens (the chrome bands take more of the height): a
    // lower camera and a wider lens lift the ball clear of the bottom band
    const h = lerp(1.3 - 0.27 * short, 0.85, a) - push * 0.05
    outP.set(BALL_X - back, h, side)
    // aim left of the ball (moves it right of centre; wider screens aim further)
    // and up a little, so the whole board sits in frame under the top band
    const yaw = lerp(0.1 + clamp((aspect - 1.3) * 0.06, 0, 0.05), -0.006, a)
    const lift = h + 40 * Math.tan(lerp(0.085, 0.0, a))
    outQ.set(outP.x + 40 * Math.cos(yaw), lift, side - 40 * Math.sin(yaw))
    return lerp(40 + 3.5 * short, 54, a) - push * 1.5
  }

  return {
    id: 'hero',
    group,
    anchors: [0.8],
    init(ctx) {
      reduced = ctx.reducedMotion
      board.tex = kickoffBoard(ctx.mobile)

      // PREGAME lower third
      intro = el('div', 'hero-intro hud-panel', undefined, ctx.stage)
      el('p', 'hud-eyebrow', MICROCOPY.signalEyebrow, intro)
      el('p', 'hud-body', BRAND.manifesto, intro)
      const hint = el('p', 'hud-label hero-hint', undefined, intro)
      el('span', 'hero-hint-text', MICROCOPY.scrollHint + ' ↓', hint)

      // PAYOFF
      scrim = el('div', 'hero-scrim', undefined, ctx.stage)
      payoff = el('div', 'hero-payoff', undefined, ctx.stage)
      kicker = el('p', 'hud-label hero-kicker', 'Kickoff · Hark vs. the Internet', payoff)
      title = rise(el('h1', 'hud-title hero-title', undefined, payoff), 'Make the internet <em>listen.</em>')
      ctas = el('div', 'hero-ctas', undefined, payoff)
      const see = el('button', 'hud-btn', 'See the work', ctas)
      see.type = 'button'
      see.addEventListener('click', () => window.__hark?.land('work'))
      const start = el('a', 'hud-btn hud-btn--ghost', 'Start a project', ctas)
      start.href = '#contact'
      start.addEventListener('click', e => {
        if (!window.__hark) return
        e.preventDefault()
        window.__hark.land('contact')
      })
    },

    update(local, frame, ctx) {
      const w = ctx.world.params
      const rm = frame.reducedMotion || reduced

      // PREGAME → all banks on: two are lit at the landing frame, the other
      // four snap on in turn by ~0.26 (the world ramps each bank; no strobing)
      w.lights = 0.36 + 0.64 * segment(local, 0.015, 0.26)
      // phone lights in the stands while the bowl is still half dark
      w.phones = 0.8 * (1 - smoothstep(0.06, 0.24, local))
      // the broadcast camera opens up for the half-lit pregame bowl
      const pre = 1 - smoothstep(0.04, 0.26, local)
      ctx.post.params.exposure = 1 + 0.55 * pre
      ctx.post.params.bloomStrength = 0.5 + 0.25 * pre
      // the wave rolls round the bowl during the dive
      w.wave = rm ? -1 : local > 0.15 && local < 0.56 ? (0.47 + (local - 0.15) * 1.9) % 1 : -1

      // the kickoff card wipes onto the board as we settle behind the ball
      if (board.tex && local > 0.44) {
        w.boardMain = board.tex
        w.boardRect.set(0, 0, 1, 1)
        w.boardMainOn = 1
        // (it wipes while the skycam looks down at the mark, so no half-wiped still)
        w.boardWipe = ease.inOutCubic(segment(local, 0.47, 0.515))
      }

      // lit props: the ball is key-lit from the home side and above
      if (local > 0.4) {
        w.keyDir.set(-0.45, 0.85, 0.8)
        w.key = 1.9
        w.fill = 0.5
        w.env = 0.85
      }

      // the ball
      const k = placeBall(local)
      // AR yellow line at the 35 paints on as we settle, clears for the kick
      line.set(35, 1 - smoothstep(0.92, 0.96, local), ease.outCubic(segment(local, 0.52, 0.6)))

      // whip smear only while actually whipping (scrolling fast through the swing)
      if (!rm) {
        const speed = clamp(Math.abs(frame.velocity) / 1.4)
        const swing = smoothstep(0.43, 0.47, local) * (1 - smoothstep(0.5, 0.54, local))
        ctx.post.params.glitch = 0.32 * swing * speed + 0.25 * smoothstep(0.0, 0.2, k) * speed
      }

      // copy
      reveal(intro, 1 - smoothstep(0.075, 0.12, local))
      const pay = smoothstep(0.6, 0.655, local) * (1 - smoothstep(0.895, 0.925, local))
      reveal(scrim, pay, 0)
      reveal(payoff, pay, 0)
      reveal(kicker, smoothstep(0.615, 0.66, local), 10)
      setRise(title, local > 0.615 && local < 0.915)
      reveal(ctas, smoothstep(0.645, 0.69, local), 12)
    },

    camera(local, frame, out) {
      const aspect = frame.width / Math.max(1, frame.height)
      const a = portraitBlend(frame)
      const rm = frame.reducedMotion || reduced
      path.setAspect(a)
      const short = clamp((780 - frame.height) / 150) * (1 - a)
      const endFov = setPose(0, a, path.endPos, path.endAim, aspect, short)

      let fov: number
      if (local < T_SET) {
        fov = path.sample(local, aspect, a, out.position, out.target, endFov)
      } else {
        const push = ease.inOutQuad(segment(local, T_SET, T_KICK))
        fov = setPose(push, a, endP, endQ, aspect, short)
        out.position.copy(endP)
        out.target.copy(endQ)
        // THE KICK: tilt up after the ball, rising a touch
        const kk = segment(local, T_KICK, 1)
        if (kk > 0) {
          const e = ease.inOutQuad(kk)
          kickP.copy(ballPivot.position).add(tmpA.set(10, 2, 0))
          out.target.lerp(kickP, e)
          out.position.y += 1.2 * e
          out.position.x -= 1.5 * e
          fov += 6 * e
        }
      }

      // wide, short screens (1920×1080, phones on their side): slide the blimp
      // shot so the bowl sits right of the pregame copy
      const wide = clamp((aspect - 1.5) / 0.7) * (1 - smoothstep(0.1, 0.24, local)) * 0.2
      if (wide > 0.001) {
        tmpA.subVectors(out.target, out.position)
        const dist = tmpA.length()
        tmpB.crossVectors(tmpA, UP).normalize()
        const shift = -wide * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * dist * aspect
        out.position.addScaledVector(tmpB, shift)
        out.target.addScaledVector(tmpB, shift)
      }

      // the skycam banks a little through the swing
      out.roll = 0.05 * Math.sin(Math.PI * segment(local, 0.4, 0.56)) * (1 - a * 0.5)

      // idle float: the blimp breathes, the skycam barely hovers (none when reduced)
      if (!rm) {
        const t = frame.time
        const high = 1 - smoothstep(0.1, 0.25, local)
        const amp = lerp(0.03, 1.1, high)
        out.position.x += Math.sin(t * 0.23) * amp
        out.position.y += Math.sin(t * 0.31 + 1.3) * amp * 0.6
        out.position.z += Math.sin(t * 0.17 + 2.1) * amp * 0.8
      }
      out.fov = fov
      out.parallax = lerp(0.25, 3, 1 - smoothstep(0.08, 0.3, local))
    },
  }
}
