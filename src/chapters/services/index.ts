import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECTIONS, SERVICES } from '../../content'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { beat } from '../common'
import { ArLine, Puck, Route } from '../../kit/ar'
import { PALETTE, yardX } from '../../kit/field'
import { isPortrait } from '../../kit/cams'
import { boardCanvas, dotMatrix, drawBoardBase } from '../../kit/board'
import { font, onFonts, trackedText } from '../../kit/type'
import { createFootball } from '../../kit/props'
import { PassArc, polyRoute, splineRoute, type Pt } from './play'
import './services.css'

/*
 * SERVICES — "Starting Eleven". The broadcast's virtual-playbook segment:
 * eleven services = the eleven players on the field. The offense lines up
 * in a shotgun, 11-personnel formation as AR player pucks (numbered 01–11 =
 * the services), and the telestrator walks through each player's assignment.
 *
 *   0.00–0.08  INTRO  skycam high behind the offense; the pucks pop into
 *              formation, the blue line of scrimmage and the yellow
 *              first-down line paint on; "Eleven ways to be heard."
 *   0.08–0.94  ELEVEN BEATS (beat()): the camera moves to feature puck i
 *              (skycam over the shoulder, low sideline, top-down, from the
 *              end zone…), the puck goes hot, its assignment draws on; the
 *              lower third names the puck that's lit. Earlier routes stay,
 *              dimmer, so the play diagram accumulates.
 *   0.94–1.00  THE FULL PLAY  pull up to a high all-22 view, every route
 *              drawn, every puck lit — then the stinger.
 *
 * Everything is a pure function of `local`.
 */

const A = 0.08
const B = 0.94
const N = SERVICES.length
const SPAN = (B - A) / N
/** phases inside a beat */
const MOVE = 0.36 // camera settles
const HOT0 = 0.14 // new puck starts to light
const HOT1 = 0.28
const SWITCH = 0.22 // card switches to the new puck (it's more than half lit)
const DRAW0 = 0.22 // telestrator
const DRAW1 = 0.52
/** the full-play pull-up */
const FULL0 = 0.934
const FULL1 = 0.964

const LOS = yardX(35) // -15: the blue line
const FD_YD = 45 // first down at the 45 (x = -5)

type Kind = 'qb' | 'line' | 'skill'
interface Cam {
  /** focus point on the turf (x, z), height */
  f: Pt
  fy?: number
  /** azimuth / elevation (deg, kit/cams orbit convention), distance, fov */
  az: number
  el: number
  d: number
  fov: number
  /** portrait overrides */
  p?: { f?: Pt; az?: number; el?: number; d?: number; fov?: number }
}
interface Player {
  pos: string
  role: string
  play: string
  x: number
  z: number
  kind: Kind
  cam: Cam
}

/*
 * The offense (facing east, +x). Service i ↔ PLAYERS[i]. The order walks the
 * formation: the QB, the left side out wide and back in, the back, the right
 * side out wide, then back along the line.
 */
const PLAYERS: Player[] = [
  // 01 Software Development — runs the offense: skycam over the shoulder
  { pos: 'QB', role: 'Quarterback', play: 'Drop, throw', x: -20.5, z: 0, kind: 'qb',
    cam: { f: [-16, 3.4], az: -100, el: 31, d: 35, fov: 44, p: { f: [-18.5, 1.5], az: -100, el: 30, d: 32, fov: 54 } } },
  // 02 Web Design — the split end, a post: from the end zone, down the sideline
  { pos: 'WR', role: 'Split end', play: 'Post', x: -15.9, z: -19.2, kind: 'skill',
    cam: { f: [-7, -16], az: -100, el: 14, d: 28, fov: 38, p: { f: [-12, -17], az: -96, el: 24, d: 34, fov: 54 } } },
  // 03 Ecommerce — the slot, an out at the sticks: top-down
  { pos: 'WR', role: 'Slot', play: 'Out at the sticks', x: -16.9, z: -11.8, kind: 'skill',
    cam: { f: [-10, -14], az: -90, el: 60, d: 30, fov: 40, p: { f: [-13.5, -13.2], az: -90, el: 56, d: 32, fov: 54 } } },
  // 04 SEO / GEO — left tackle: high, behind the left side
  { pos: 'LT', role: 'Left tackle', play: 'Kick slide', x: -16.0, z: -3.2, kind: 'line',
    cam: { f: [-16.2, -4], az: -122, el: 34, d: 19, fov: 38, p: { f: [-16.4, -3.8], az: -115, el: 32, d: 21, fov: 52 } } },
  // 05 Page Speed — the running back, a wheel: high skycam from behind the right side
  { pos: 'RB', role: 'Running back', play: 'Wheel', x: -20.6, z: 1.8, kind: 'skill',
    cam: { f: [-15, 7.5], az: -55, el: 30, d: 30, fov: 40, p: { f: [-18.5, 3.8], az: -80, el: 36, d: 34, fov: 54 } } },
  // 06 AI Consulting — the tight end, a curl: from the home side
  { pos: 'TE', role: 'Tight end', play: 'Curl', x: -16.2, z: 4.9, kind: 'skill',
    cam: { f: [-11.5, 4.5], az: 40, el: 22, d: 22, fov: 36, p: { f: [-13.5, 4.8], az: -70, el: 28, d: 25, fov: 52 } } },
  // 07 Aerial Photography & Video — the flanker, a go route under the ball: from the far end
  { pos: 'WR', role: 'Flanker', play: 'Go', x: -16.9, z: 17.6, kind: 'skill',
    cam: { f: [-9, 16.5], az: -68, el: 19, d: 27, fov: 40, p: { f: [-14, 17.2], az: -80, el: 24, d: 32, fov: 54 } } },
  // 08 Hack Remediation — right tackle: high, from the home side
  { pos: 'RT', role: 'Right tackle', play: 'Kick slide', x: -16.0, z: 3.2, kind: 'line',
    cam: { f: [-16.2, 4], az: 55, el: 28, d: 19, fov: 36, p: { f: [-16.4, 3.8], az: -65, el: 32, d: 21, fov: 52 } } },
  // 09 Website & Data Security — right guard: top-down
  { pos: 'RG', role: 'Right guard', play: 'Pass pro', x: -15.9, z: 1.6, kind: 'line',
    cam: { f: [-15, 1.7], az: -90, el: 64, d: 20, fov: 38, p: { f: [-15.2, 1.7], az: -90, el: 58, d: 22, fov: 52 } } },
  // 10 ADA Accessibility — center: from the defense's side of the ball
  { pos: 'C', role: 'Center', play: 'Snap, anchor', x: -15.8, z: 0, kind: 'line',
    cam: { f: [-16.8, 0], az: 90, el: 16, d: 19, fov: 36, p: { f: [-17, 0], az: 90, el: 22, d: 21, fov: 52 } } },
  // 11 WordPress — left guard: over the line from behind
  { pos: 'LG', role: 'Left guard', play: 'Pass pro', x: -15.9, z: -1.6, kind: 'line',
    cam: { f: [-15.4, -1.8], az: -115, el: 24, d: 18, fov: 38, p: { f: [-15.4, -1.8], az: -100, el: 28, d: 20, fov: 52 } } },
]

type StrokeKind = 'route' | 'block' | 'throw'
/** the assignments, in turf coordinates (x, z) */
function buildStrokes(): { stroke: Stroke; owner: number; t0: number; t1: number; kind: StrokeKind }[] {
  const out: { stroke: Stroke; owner: number; t0: number; t1: number; kind: StrokeKind }[] = []
  const add = (owner: number, stroke: Stroke, t0 = DRAW0, t1 = DRAW1, kind: StrokeKind = 'route') => out.push({ stroke, owner, t0, t1, kind })
  const W = 0.4
  const route = (pts: THREE.Vector2[]) => new Route(pts, { width: W, smooth: false, chalk: 0.5 })
  // 01 QB: a three-step drop, then the throw (a 3D flight arc onto the go route)
  add(0, route(polyRoute([[-20.5, 0], [-23.0, 0]])), DRAW0, 0.3)
  add(0, new PassArc([-23.0, 0], [9.5, 17.8], 7), 0.3, DRAW1 + 0.02, 'throw')
  // 02 X: post
  add(1, route(polyRoute([[-15.9, -19.2], [-4.2, -19.2], [5.5, -10.6]], 1.1)))
  // 03 slot: out at the sticks
  add(2, route(polyRoute([[-16.9, -11.8], [-5.6, -11.8], [-5.6, -15.9]], 0.8)))
  // 05 RB: wheel
  add(4, route(splineRoute([[-20.6, 1.8], [-21.0, 4.4], [-19.9, 7.3], [-17.2, 9.6], [-12.8, 11.0], [-6, 11.7], [1.5, 12.0]])))
  // 06 TE: curl
  add(5, route(polyRoute([[-16.2, 4.9], [-7.6, 5.0], [-9.0, 3.4]], 0.9)))
  // 07 Z: go
  add(6, route(polyRoute([[-16.9, 17.6], [-9, 17.7], [13, 18.1]])))
  // the line: a short stroke to the rusher and a "T" bar (tackles kick back
  // and out to the edge; guards and center punch forward)
  const block = (owner: number, x: number, z: number, dx: number, dz: number, t0 = DRAW0, split = 0.4, t1 = 0.52) => {
    const l = Math.hypot(dx, dz)
    const ux = dx / l
    const uz = dz / l
    const ex = x + dx
    const ez = z + dz
    const s = 0.72
    const opts = { width: 0.36, smooth: false, arrow: false, chalk: 0.5 }
    add(owner, new Route([new THREE.Vector2(x + ux * 0.72, z + uz * 0.72), new THREE.Vector2(ex, ez)], opts), t0, split, 'block')
    add(owner, new Route([new THREE.Vector2(ex + uz * s, ez - ux * s), new THREE.Vector2(ex - uz * s, ez + ux * s)], opts), split, t1, 'block')
  }
  block(3, -16.0, -3.2, -1.1, -1.5) // LT kick slide
  block(7, -16.0, 3.2, -1.1, 1.5) // RT kick slide
  block(8, -15.9, 1.6, 1.7, 0.3) // RG
  block(10, -15.9, -1.6, 1.7, -0.3) // LG
  // C: the snap back to the QB, then the block
  add(9, new Route([new THREE.Vector2(-15.2, 0), new THREE.Vector2(-19.7, 0)], { width: 0.24, smooth: false, dash: 0.55, chalk: 0.2, color: PALETTE.chalk, glow: 1.1 }), DRAW0, 0.36, 'block')
  block(9, -15.8, 0, 1.75, 0, 0.3, 0.42, 0.54)
  return out
}

interface Stroke {
  group: THREE.Object3D
  set(draw: number, opacity?: number): void
}

/** the pucks pop in the line first, then outward (PLAYERS indices) */
const POP_ORDER: number[] = [9, 10, 8, 3, 7, 5, 0, 4, 2, 6, 1] // players, in pop order

interface PoseX {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
  ox: number
  oy: number
}
const poseX = (): PoseX => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 40, ox: 0, oy: 0 })
const D2R = Math.PI / 180
const NO_OVERRIDE: NonNullable<Cam['p']> = {}

export default function create(): Chapter {
  const group = new THREE.Group()
  const B0 = beat(0, N, A, B)
  let intro: HTMLElement, introTitle: HTMLElement, eyebrow: HTMLElement
  let card: HTMLElement, cardInner: HTMLElement, no: HTMLElement, pos: HTMLElement, title: HTMLElement, blurb: HTMLElement, tags: HTMLElement
  const pips: HTMLElement[] = []
  let shown = -2
  /** where the lower third starts (fraction of the viewport height), measured on resize / content change */
  let cardTop = 0.6
  const measureCard = () => {
    const r = card.getBoundingClientRect()
    if (r.height > 0 && window.innerHeight > 0) cardTop = r.top / window.innerHeight
  }
  let reduced = false

  const pucks: Puck[] = []
  /** the kit puck's number tag (sized/dimmed here so neighbours don't crowd) */
  const tagSprites: THREE.Sprite[] = []
  let post: ChapterContext['post'] | null = null
  let strokes: ReturnType<typeof buildStrokes> = []
  let los: ArLine, fd: ArLine
  let ball: THREE.Group | null = null
  let arc: PassArc | null = null
  let boardTex: THREE.Texture | null = null

  // scratch (no per-frame allocation)
  const pa = poseX()
  const pb = poseX()
  const pc = poseX()
  const _f = new THREE.Vector3()
  const _r = new THREE.Vector3()
  const _u = new THREE.Vector3()
  const _t = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  const XA = new THREE.Vector3(1, 0, 0)

  /** where the subject sits on screen (NDC) while a card is up */
  const setOffsets = (frame: Frame, out: PoseX) => {
    if (isPortrait(frame)) {
      // centre the subject in the band between the top chrome and the card
      const top = clamp(0.105 * frame.height, 80, 112) / Math.max(1, frame.height)
      out.ox = 0
      out.oy = clamp(1 - (top + cardTop), 0.14, 0.5)
      return
    }
    // the card takes more of a 4:3 screen (and of a phone on its side):
    // push the subject further right
    const short = frame.height < 520
    out.ox = short ? 0.36 : frame.width / frame.height < 1.45 ? 0.3 : 0.24
    out.oy = short ? 0.16 : 0.1
  }

  function introPose(local: number, frame: Frame, out: PoseX) {
    // the skycam glides down behind the offense: the formation below, the
    // board and the bowl beyond
    const t = ease.outCubic(segment(local, 0, A))
    if (isPortrait(frame)) {
      out.pos.set(lerp(-62, -38, t), lerp(26, 12, t), lerp(10, 5, t))
      out.tgt.set(lerp(-6, -9, t), lerp(3, -0.8, t), -1)
      out.fov = 62
    } else {
      out.pos.set(lerp(-58, -33, t), lerp(20, 9.5, t), lerp(16, 8, t))
      out.tgt.set(lerp(-2, -6, t), lerp(8, 1.7, t), lerp(-2, -1, t))
      out.fov = lerp(46, 50, t)
    }
    out.ox = 0
    out.oy = 0
    return out
  }

  function featurePose(j: number, hold: number, frame: Frame, out: PoseX) {
    const c = PLAYERS[j].cam
    const portrait = isPortrait(frame)
    const p = (portrait && c.p) || NO_OVERRIDE
    const f = p.f ?? c.f
    const drift = reduced ? 0 : hold
    const d = (p.d ?? c.d) * (1 - 0.05 * drift)
    const az = ((p.az ?? c.az) + 2.5 * drift) * D2R
    const elv = (p.el ?? c.el) * D2R
    out.tgt.set(f[0], c.fy ?? 0.4, f[1])
    const ce = Math.cos(elv)
    out.pos.set(out.tgt.x + Math.sin(az) * ce * d, out.tgt.y + Math.sin(elv) * d, out.tgt.z + Math.cos(az) * ce * d)
    out.fov = p.fov ?? c.fov
    setOffsets(frame, out)
    return out
  }

  function fullPose(frame: Frame, out: PoseX) {
    // the all-22: high behind the offense, the whole play on the field
    if (isPortrait(frame)) {
      out.tgt.set(-5, 0, -0.8)
      out.pos.set(-54, 86, -0.8)
      out.fov = 58
      out.ox = 0
      out.oy = 0.06
    } else {
      out.tgt.set(-5, 0, -0.5)
      out.pos.set(-44, 50, 0)
      out.fov = 44
      out.ox = 0
      out.oy = 0
    }
    return out
  }

  function blend(out: PoseX, a: PoseX, b: PoseX, t: number) {
    out.pos.lerpVectors(a.pos, b.pos, t)
    out.tgt.lerpVectors(a.tgt, b.tgt, t)
    out.fov = lerp(a.fov, b.fov, t)
    out.ox = lerp(a.ox, b.ox, t)
    out.oy = lerp(a.oy, b.oy, t)
    // the cable cam rises a little between marks
    const lift = Math.min(9, a.pos.distanceTo(b.pos) * 0.18)
    out.pos.y += Math.sin(Math.PI * t) * lift
    return out
  }

  /** pan so the pose's target lands at NDC (ox, oy) */
  function applyPose(out: CameraPose, p: PoseX, aspect: number) {
    out.position.copy(p.pos)
    out.fov = p.fov
    _f.subVectors(p.tgt, p.pos)
    const d = _f.length()
    _f.divideScalar(d)
    _r.crossVectors(_f, UP).normalize()
    _u.crossVectors(_r, _f)
    const th = Math.tan(p.fov * D2R * 0.5)
    _f.addScaledVector(_r, -p.ox * th * aspect).addScaledVector(_u, -p.oy * th).normalize()
    out.target.copy(p.pos).addScaledVector(_f, d)
  }

  /** hot 0..1 of puck j at `local` */
  const hotOf = (j: number, local: number) => {
    const a = A + SPAN * j
    const on = smoothstep(a + SPAN * HOT0, a + SPAN * HOT1, local)
    const off = j === N - 1 ? 0 : smoothstep(a + SPAN * (1 + 0.02), a + SPAN * (1 + HOT0), local)
    return Math.max(on * (1 - off), smoothstep(FULL0, FULL0 + 0.014, local))
  }

  function showCard(i: number) {
    shown = i
    if (i < 0) return
    const s = SERVICES[i]
    const p = PLAYERS[i]
    no.textContent = s.num
    pos.innerHTML = ''
    el('b', '', p.pos, pos)
    pos.appendChild(document.createTextNode(` ${p.role} · ${p.play}`))
    title.textContent = s.title
    blurb.textContent = s.blurb
    tags.replaceChildren(...s.tags.map(t => Object.assign(document.createElement('li'), { className: 'hud-tag', textContent: t })))
    pips.forEach((pip, k) => {
      pip.className = k < i ? 'is-done' : k === i ? 'is-on' : ''
    })
    if (!reduced && typeof cardInner.animate === 'function') {
      cardInner.animate(
        [
          { opacity: 0, transform: 'translate3d(-14px,0,0)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 320, easing: 'cubic-bezier(0.16, 0.9, 0.2, 1)' },
      )
    }
  }

  function drawBoard(mobile: boolean) {
    const b = boardCanvas(mobile)
    const paint = () => {
      const { ctx, W, H } = b
      drawBoardBase(ctx, W, H, 'STARTING ELEVEN')
      const cell = W * 0.0074
      dotMatrix(ctx, '11 PERSONNEL', W * 0.045, H * 0.27, cell, PALETTE.yellow, { rows: 14 })
      ctx.fillStyle = PALETTE.chalk
      ctx.textBaseline = 'middle'
      ctx.font = font('display', H * 0.085, 800, true)
      trackedText(ctx, 'SHOTGUN  ·  1ST & 10  ·  OFFENSE', W * 0.047, H * 0.72, 0.04, 'left')
      ctx.fillStyle = 'rgba(243,244,238,0.6)'
      ctx.font = font('mono', H * 0.04, 500)
      trackedText(ctx, 'VIRTUAL PLAYBOOK  ·  01—11', W * 0.048, H * 0.84, 0.14, 'left')
      b.tex.needsUpdate = true
    }
    onFonts(paint)
    return b.tex
  }

  return {
    id: 'services',
    group,
    anchors: B0.centers,

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      post = ctx.post
      // ---- DOM ----
      intro = el('div', 'sv-intro', undefined, ctx.stage)
      eyebrow = el('p', 'hud-eyebrow sv-eyebrow', `${SECTIONS.services.eyebrow} · 01—11`, intro)
      introTitle = rise(el('h2', 'hud-h2 sv-h2', undefined, intro), 'Eleven ways to be <em>heard.</em>')

      card = el('div', 'sv-card hud-panel', undefined, ctx.stage)
      cardInner = el('div', 'sv-inner', undefined, card)
      const head = el('div', 'sv-head', undefined, cardInner)
      no = el('span', 'sv-no', '01', head)
      const meta = el('div', 'sv-meta', undefined, head)
      pos = el('p', 'hud-label sv-pos', '', meta)
      const pipRow = el('ol', 'sv-pips', undefined, meta)
      for (let i = 0; i < N; i++) pips.push(el('li', '', undefined, pipRow))
      title = el('h3', 'sv-title', '', cardInner)
      blurb = el('p', 'hud-body sv-blurb', '', cardInner)
      tags = el('ul', 'hud-tags sv-tags', undefined, cardInner)
      reveal(card, 0, 0)
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measureCard).observe(card)
      window.addEventListener('resize', measureCard)

      // ---- the field graphics ----
      los = new ArLine({ color: '#3d8bff', width: 0.32, glow: 1.25 })
      fd = new ArLine({ color: PALETTE.yellow, width: 0.34, glow: 1.2 })
      group.add(los.mesh, fd.mesh)
      await nextFrame()

      for (let i = 0; i < N; i++) {
        const p = new Puck({ number: SERVICES[i].num, color: PALETTE.chalk, radius: 0.64, pillar: 2.7 })
        pucks.push(p)
        tagSprites.push(p.group.children.find(o => (o as THREE.Sprite).isSprite) as THREE.Sprite)
        group.add(p.group)
      }
      await nextFrame()

      strokes = buildStrokes()
      for (const s of strokes) {
        group.add(s.stroke.group)
        if (s.stroke instanceof PassArc) arc = s.stroke
      }
      ball = createFootball({ detail: 24 })
      ball.scale.setScalar(2.4)
      group.add(ball)
      boardTex = drawBoard(ctx.mobile)
    },

    update(local, frame, ctx) {
      reduced = frame.reducedMotion
      const w = ctx.world.params
      w.stands = 0.8
      w.mark = 0.85
      if (boardTex) w.boardBg = boardTex

      // ---- copy ----
      const introOn = local > 0.016 && local < 0.094
      setRise(introTitle, introOn)
      reveal(eyebrow, smoothstep(0.018, 0.03, local) * (1 - smoothstep(0.088, 0.1, local)), 0)
      const cardVis = smoothstep(A + SPAN * (SWITCH - 0.02), A + SPAN * (SWITCH + 0.06), local) * (1 - smoothstep(FULL0 - 0.004, FULL0 + 0.008, local))
      reveal(card, cardVis, 0)
      const want = clamp(Math.floor((local - A) / SPAN - SWITCH), -1, N - 1)
      if (want !== shown && want >= 0) showCard(want)

      // ---- lines ----
      los.set(35, 1, ease.outCubic(segment(local, 0.034, 0.058)))
      fd.set(FD_YD, 1, ease.outCubic(segment(local, 0.046, 0.07)))

      // ---- pucks ----
      const full = smoothstep(FULL0, FULL1, local)
      for (let k = 0; k < N; k++) {
        const j = POP_ORDER[k]
        const t0 = 0.026 + k * 0.0032
        const t = segment(local, t0, t0 + 0.012)
        const p = PLAYERS[j]
        const hot = hotOf(j, local)
        pucks[j].set(p.x, p.z, { on: clamp(t * 1.6), hot, tag: clamp(t * 1.4 - 0.2) * lerp(0.82, 1, hot), pillar: 1 })
        const sp = tagSprites[j]
        if (sp) {
          const k = lerp(0.66, 0.9, hot) * (1 + 0.5 * full)
          sp.scale.set(1.9 * k, 0.95 * k, 1)
          ;(sp.material as THREE.SpriteMaterial).color.setScalar(lerp(0.8, 1, hot))
        }
        const s = t <= 0 ? 0.001 : ease.outBack(t)
        pucks[j].group.scale.setScalar(Math.max(0.001, s) * (1 + 0.22 * full))
      }

      // ---- the telestrator ----
      for (const s of strokes) {
        const a = A + SPAN * s.owner
        const d = ease.inOutQuad(segment(local, a + SPAN * s.t0, a + SPAN * s.t1))
        // current: full; after its beat: dimmer (the diagram accumulates); the full play: all up
        const next = a + SPAN
        let o = 1 - 0.58 * smoothstep(next + SPAN * 0.02, next + SPAN * HOT0, local)
        // the throw lands on the go route: relight it for 07
        if (s.kind === 'throw') {
          const a7 = A + SPAN * 6
          o = Math.max(o, 0.95 * smoothstep(a7 + SPAN * HOT0, a7 + SPAN * HOT1, local) * (1 - smoothstep(a7 + SPAN * 1.02, a7 + SPAN * (1 + HOT0), local)))
        }
        o = lerp(o, 1, full)
        s.stroke.set(d, o * (s.kind === 'block' ? 0.95 : 1))
      }

      // ---- the ball in flight (only while the throw draws) ----
      if (ball && arc) {
        const a = A
        const d = ease.inOutQuad(segment(local, a + SPAN * 0.3, a + SPAN * (DRAW1 + 0.02)))
        ball.visible = d > 0.002 && d < 0.985
        if (ball.visible) {
          arc.at(d, ball.position)
          arc.tangent(d, _t)
          ball.quaternion.setFromUnitVectors(XA, _t)
          ball.rotateX(d * 26)
        }
      }
    },

    camera(local, frame, out) {
      const aspect = frame.width / Math.max(1, frame.height)
      let p: PoseX
      if (local < A) {
        p = introPose(local, frame, pc)
      } else if (local < FULL0) {
        // beat() without its per-call centers array
        const j = clamp(Math.floor((local - A) / SPAN), 0, N - 1)
        const phase = clamp((local - A - j * SPAN) / SPAN)
        const hold = segment(phase, MOVE, 1)
        const to = featurePose(j, hold, frame, pb)
        const from = j === 0 ? introPose(A, frame, pa) : featurePose(j - 1, 1, frame, pa)
        const tm = segment(phase, 0, MOVE)
        const t = ease.inOutCubic(tm)
        p = t >= 1 ? to : blend(pc, from, to, t)
        // a long cable-cam move smears a touch mid-flight (whip-pan) — only
        // while the reader is actually scrolling, never on a parked frame
        if (post && !reduced && tm > 0 && tm < 1) {
          const far = clamp((from.pos.distanceTo(to.pos) - 18) / 30)
          const moving = clamp(Math.abs(frame.velocity) / 2.2)
          post.params.glitch = Math.max(post.params.glitch, Math.sin(Math.PI * tm) ** 2 * far * moving * 0.45)
        }
      } else {
        const from = featurePose(N - 1, 1, frame, pa)
        const to = fullPose(frame, pb)
        p = blend(pc, from, to, ease.inOutCubic(segment(local, FULL0, FULL1)))
      }
      applyPose(out, p, aspect)
      out.parallax = isPortrait(frame) ? 0.15 : 0.35
    },
  }
}
