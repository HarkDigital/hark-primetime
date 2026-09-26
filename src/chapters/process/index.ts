import * as THREE from 'three'
import type { CameraPose, Chapter, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { PROCESS, STATS } from '../../content'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { beat } from '../common'
import { ArLabel, ArLine, Puck } from '../../kit/ar'
import { PALETTE, yardX } from '../../kit/field'
import { createFootball } from '../../kit/props'
import { BOARD, boardCanvas } from '../../kit/board'
import { isPortrait, makePose, orbit, type PoseLike } from '../../kit/cams'
import { onFonts } from '../../kit/type'
import { nextFrame } from '../../core/yield'
import { TIERS, ringLength } from '../../world/bowl'
import { PlayArc, TurfText, blobTexture, chipTexture, drawStatsBoard, type BoardStat } from './drive'
import './process.css'

/*
 * PROCESS — "The Drive". How every engagement runs, told as a four-play
 * scoring drive on the broadcast's drive-chart graphic:
 *
 *   0.00–0.10  intro: the all-22 camera high on the home side over the WEST
 *              half; the ball spotted at the 20, scrimmage (blue) and
 *              first-down (yellow) lines keyed on; the title wipes in
 *   0.10–0.78  four plays (beat): each step is a pass that gains ~20 yards —
 *              the arc draws in the air behind the ball, its curtain hangs to
 *              the turf, the lines move up, the step's name keys onto the
 *              turf, the camera dollies east along the sideline. Earlier arcs
 *              stay (dimmed): the drive chart accumulates. Play 4 scores.
 *   0.78–0.95  the camera jibs up to the video board: the three stats in LED
 *              lettering (and verbatim in the lower third)
 *   0.95–1.00  push in on the board into the stinger
 *
 * Everything derives from `local`; frame.time only drives idle hover/drift.
 */
const SHOW = [STATS[0], STATS[2], STATS[1]] // 10 years, $1M+, 15
/** the board's short labels: fragments of the verbatim stat labels */
const BOARD_STATS: BoardStat[] = [
  { value: SHOW[0].value, lines: ['OF CUSTOM SOFTWARE', 'FOR REAL BUSINESSES'] },
  { value: SHOW[1].value, lines: ['FLOWS THROUGH CLIENT STORES', 'EVERY SINGLE YEAR'] },
  { value: SHOW[2].value, lines: ['LIVE SITES IN THE PORTFOLIO', 'RIGHT NOW'] },
]

/** ball spots (yards from the WEST goal line) — four plays, 20 → the end zone */
const SPOTS = [
  { yd: 20, z: 0 },
  { yd: 41, z: -2.2 },
  { yd: 63, z: 1.8 },
  { yd: 82, z: -1.1 },
  { yd: 104, z: 0.4 },
]
/** yards gained per play (the last one to the goal line) */
const GAINS = [21, 22, 19, 18]
/** carry height of the ball over its spot */
const H0 = 1.15

const A0 = 0.1
const A1 = 0.78
const SPAN = (A1 - A0) / PROCESS.length
/** inside each play's slot (0..1): the flight, the lines moving up, the camera move */
const FLY = [0.03, 0.38] as const
const LINES = [0.3, 0.44] as const
const CAM = [0.0, 0.44] as const

/** the ribbon's default ~120 yd repeat, rounded to fit the bowl exactly */
const RIBBON_REPEAT = ringLength(TIERS.ribbon.d) / Math.round(ringLength(TIERS.ribbon.d) / 120)

const pad = (n: number) => String(n).padStart(2, '0')
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const smooth = (t: number) => t * t * (3 - 2 * t)

export default function create(): Chapter {
  const group = new THREE.Group()
  let rm = false
  let ready = false

  // ---- 3D ----
  const arcs: PlayArc[] = []
  const labels: TurfText[] = []
  const tags: THREE.Sprite[] = []
  const nodes: THREE.Mesh[] = []
  let los: ArLine
  let fd: ArLine
  let dd: ArLabel
  let ball: THREE.Group
  let shadow: THREE.Mesh
  let shadowMat: THREE.MeshBasicMaterial
  let puck: Puck
  let board: ReturnType<typeof boardCanvas>

  // ---- DOM ----
  let head: HTMLElement
  let title: HTMLElement
  let scrim: HTMLElement
  let panel: HTMLElement
  let swap: HTMLElement
  let stepNum: HTMLElement
  let stepTitle: HTMLElement
  let stepText: HTMLElement
  let fill: HTMLElement
  let dot: HTMLElement
  let cap: HTMLElement
  let stats: HTMLElement
  /** where the copy sits (CSS px), measured on resize — the board shot frames around it */
  const lay = { ok: false, gut: 0, top: 0, headR: 0, headB: 0, panelT: 0, statsT: 0, statsR: 0, statsB: 0 }
  function measure() {
    if (!stats.offsetHeight) return
    lay.gut = head.offsetLeft
    lay.top = head.offsetTop
    lay.headR = head.offsetLeft + head.offsetWidth
    lay.headB = head.offsetTop + head.offsetHeight
    lay.panelT = panel.offsetTop
    lay.statsT = stats.offsetTop
    lay.statsR = stats.offsetLeft + stats.offsetWidth
    lay.statsB = stats.offsetTop + stats.offsetHeight
    lay.ok = true
  }
  let shown = -1
  let capShown = -1
  let fillShown = ''
  let flip = false

  // ---- scratch (no per-frame allocation) ----
  const spotV = SPOTS.map(s => new THREE.Vector3(yardX(s.yd), H0, s.z))
  const tmpV = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const X = new THREE.Vector3(1, 0, 0)
  const Yup = new THREE.Vector3(0, 1, 0)
  const qa = new THREE.Quaternion()
  const qb = new THREE.Quaternion()
  const eul = new THREE.Euler()
  const subj = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const right = new THREE.Vector3()
  const upv = new THREE.Vector3()
  /** per-play flight / keyed-on progress, refilled every frame */
  const fl = [0, 0, 0, 0]
  const ky = [0, 0, 0, 0]
  const pA = makePose()
  const pB = makePose()
  const pC = makePose()

  /** flight progress of play i (0..1) at this local */
  function flight(i: number, local: number) {
    const s = A0 + i * SPAN
    if (rm) return local >= s ? 1 : 0
    return smooth(seg(local, s + FLY[0] * SPAN, s + FLY[1] * SPAN))
  }
  /** the lines/label keying-on after play i lands (0..1) */
  function keyed(i: number, local: number) {
    const s = A0 + i * SPAN
    if (rm) return local >= s ? 1 : 0
    return smooth(seg(local, s + LINES[0] * SPAN, s + LINES[1] * SPAN))
  }
  /** continuous camera cursor: -1 = the intro spot, i = at rest after play i */
  function camCursor(local: number) {
    let c = -1
    for (let i = 0; i < PROCESS.length; i++) {
      const s = A0 + i * SPAN
      const k = rm ? (local >= s ? 1 : 0) : ease.inOutCubic(seg(local, s + CAM[0] * SPAN, s + CAM[1] * SPAN))
      c += k
    }
    return c
  }

  /**
   * Orbit `subject` then slide camera + target sideways/up in screen space so
   * the subject lands at (sx, sy) in NDC.
   */
  function aim(out: PoseLike, subject: THREE.Vector3, az: number, el: number, dist: number, fov: number, sx: number, sy: number, aspect: number) {
    orbit(out, subject, dist, az, el, fov)
    dir.subVectors(out.target, out.position).normalize()
    right.crossVectors(dir, Yup).normalize()
    upv.crossVectors(right, dir).normalize()
    const halfH = Math.tan(THREE.MathUtils.degToRad(fov) / 2) * dist
    const halfW = halfH * aspect
    out.position.addScaledVector(right, -sx * halfW).addScaledVector(upv, -sy * halfH)
    out.target.addScaledVector(right, -sx * halfW).addScaledVector(upv, -sy * halfH)
    return out
  }

  /** the all-22 sideline pose for camera cursor c (-1..3), continuous */
  function drivePose(out: PoseLike, c: number, frame: Frame) {
    const portrait = isPortrait(frame)
    const aspect = frame.width / frame.height
    // focus: the play's midpoint (the intro frames the spot and the field ahead)
    const i = Math.max(-1, Math.min(3, c))
    const i0 = Math.floor(i)
    const f = i - i0
    const fx = (k: number) => (k < 0 ? spotV[0].x + 7 : (spotV[k].x + spotV[k + 1].x) / 2)
    const fz = (k: number) => (k < 0 ? spotV[0].z : (spotV[k].z + spotV[k + 1].z) / 2)
    const x = lerp(fx(i0), fx(Math.min(3, i0 + 1)), f)
    const z = lerp(fz(i0), fz(Math.min(3, i0 + 1)), f)
    subj.set(x, 2.5, z)
    // a small jib lift mid-move
    const lift = Math.sin(Math.PI * f) * 0.06
    if (portrait) {
      // the play sits in the free band between the title and the lower third
      const Hp = frame.height
      const b0 = lay.ok ? lay.headB + 6 : Hp * 0.23
      const b1 = lay.ok ? lay.panelT - 6 : Hp * 0.68
      const band = Math.max(120, b1 - b0)
      const scale = clamp(Hp / band / 2.19, 0.9, 1.3)
      // pull back only so far (past ~118 yd the camera would sit behind a light
      // tower at z = 104), then widen the lens for the rest
      const dist = 112 * Math.min(scale, 1.05)
      const fov = 2 * THREE.MathUtils.radToDeg(Math.atan((Math.tan(THREE.MathUtils.degToRad(20)) * scale * 112) / dist))
      aim(out, subj, 0.02, 0.74 + lift, dist, fov, 0.06, 1 - (b0 + b1) / Hp, aspect)
    } else {
      const narrow = clamp((1.6 - aspect) / 0.35) // 1024×768 pulls back a touch
      aim(out, subj, -0.06, 0.5 + lift, 84 + narrow * 14, 28, 0.2, -0.02, aspect)
    }
    return out
  }

  /**
   * Landscape only: the drive summary — the whole chart from the 20 to the
   * end zone in one wide, high all-22 frame (step 4 widens into it).
   */
  function summaryPose(out: PoseLike, frame: Frame) {
    const aspect = frame.width / frame.height
    subj.set((spotV[0].x + spotV[4].x) / 2 + 2, 2.5, 0)
    const sx = 0.16
    const halfW = (spotV[4].x - spotV[0].x) / 2 + 5
    // a wider lens from inside the bowl (further back, the camera would sit behind a light tower)
    const dist = halfW / ((1 - sx) * Math.tan(THREE.MathUtils.degToRad(19)) * aspect)
    return aim(out, subj, -0.05, 0.66, Math.min(dist, 118), 38, sx, -0.04, aspect)
  }

  /**
   * The video board pose (stats beat): the board is fitted into the largest
   * free rectangle the copy leaves (measured from the DOM on resize) — right
   * of the stats sheet, or right of the title and above the sheet; on
   * portrait, between the top band and the sheet (the title steps aside).
   */
  function boardPose(out: PoseLike, frame: Frame) {
    const portrait = isPortrait(frame)
    const Wp = frame.width
    const Hp = frame.height
    const aspect = Wp / Hp
    const fov = portrait ? 46 : 32
    const azo = portrait ? 0.08 : 0.2
    const gut = lay.ok ? lay.gut : Math.min(48, Math.max(16, Wp * 0.034))
    const top = lay.ok ? lay.top : Math.min(112, Math.max(80, Hp * 0.105))
    const sT = lay.ok ? lay.statsT : Hp * 0.6
    const sR = lay.ok ? lay.statsR : gut + Math.min(468, Wp - 2 * gut)
    const sB = lay.ok ? lay.statsB : Hp - top
    const BA = BOARD.width / BOARD.height
    let x0: number, x1: number, y0: number, y1: number
    const fit = (w: number, h: number) => Math.min(w, h * BA)
    if (portrait) {
      x0 = gut
      x1 = Wp - gut
      y0 = top + 4
      y1 = sT - 18
    } else {
      // A: right of the sheet, full height; B: right of the title, above the sheet
      const aw = fit(Wp - gut - (sR + 28), sB - top)
      const hR = lay.ok ? lay.headR : gut + Wp * 0.3
      const bw = fit(Wp - gut - (hR + 28), sT - 22 - top)
      if (aw >= bw) {
        x0 = sR + 28
        y1 = sB
      } else {
        x0 = hR + 28
        y1 = sT - 22
      }
      x1 = Wp - gut
      y0 = top + 16
    }
    const bwPx = Math.min(fit(x1 - x0, y1 - y0) * 0.94, Wp * (portrait ? 0.94 : 0.6))
    const bhPx = bwPx / BA
    // right-aligned on landscape, centred on portrait; a little high in its slot
    const cx = portrait ? (x0 + x1) / 2 : x1 - bwPx / 2
    const cy = y0 + bhPx / 2 + (y1 - y0 - bhPx) * (portrait ? 0.42 : 0.18)
    const f = bwPx / Wp
    const dist = (BOARD.width * 0.5 * Math.cos(azo)) / (f * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect)
    subj.copy(BOARD.center)
    aim(out, subj, -Math.PI / 2 + azo, portrait ? 0.1 : 0.14, dist, fov, (cx / Wp) * 2 - 1, 1 - (cy / Hp) * 2, aspect)
    return out
  }

  return {
    id: 'process',
    group,
    // the four steps, then the stats beat (srContent makes the first stat a keyboard stop)
    anchors: [...beat(0, PROCESS.length, A0, A1).centers, 0.88],

    async init(ctx) {
      rm = ctx.reducedMotion
      const mobile = ctx.mobile

      // ---- DOM: title (top-left), the lower third, the stats sheet ----
      scrim = el('div', 'pt-scrim', undefined, ctx.stage)
      head = el('div', 'pt-head', undefined, ctx.stage)
      el('p', 'hud-eyebrow', 'How we work', head)
      title = rise(el('h2', 'hud-h2 pt-title', undefined, head), 'We listen first. <br><em>Then we build.</em>')

      panel = el('div', 'pt-panel hud-panel', undefined, ctx.stage)
      swap = el('div', 'pt-swap', undefined, panel)
      stepNum = el('p', 'hud-label pt-num', '', swap)
      stepTitle = el('h3', 'pt-step', '', swap)
      stepText = el('p', 'hud-body pt-text', '', swap)
      const drive = el('div', 'pt-drive', undefined, panel)
      const bar = el('div', 'pt-bar', undefined, drive)
      el('i', 'pt-ez', undefined, bar)
      el('i', 'pt-ez pt-ez--e', undefined, bar)
      fill = el('i', 'pt-fill', undefined, bar)
      dot = el('i', 'pt-dot', undefined, bar)
      cap = el('p', 'hud-label pt-cap', '', drive)

      stats = el('div', 'pt-stats hud-panel', undefined, ctx.stage)
      el('p', 'hud-label pt-kicker', 'By the numbers', stats)
      const ul = el('ul', 'pt-statlist', undefined, stats)
      for (const s of SHOW) {
        const li = el('li', '', undefined, ul)
        el('span', 'pt-v', s.value, li)
        el('span', 'pt-l', s.label, li)
      }
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure)
        ro.observe(head)
        ro.observe(panel)
        ro.observe(stats)
      }
      window.addEventListener('resize', measure)

      // ---- 3D: lines, the ball, the spot marker ----
      los = new ArLine({ color: '#3d8bff', width: 0.36, glow: 1.05 })
      fd = new ArLine({ color: PALETTE.yellow, width: 0.36, glow: 1.2 })
      dd = new ArLabel('1ST & 10', { width: 7.5, up: '-z', px: mobile ? 128 : 256 })
      group.add(los.mesh, fd.mesh, dd.mesh)

      ball = createFootball({ detail: mobile ? 28 : 40 })
      ball.scale.setScalar(8)
      group.add(ball)
      shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: blobTexture(), transparent: true, depthWrite: false, opacity: 0.5 })
      shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat)
      shadow.position.y = 0.04
      shadow.renderOrder = 4
      group.add(shadow)
      puck = new Puck({ color: '#ffffff', hot: PALETTE.yellow, radius: 1.25, pillar: 2.2 })
      group.add(puck.group)
      await nextFrame()

      // ---- the drive chart: arcs, spot nodes, step names, yardage tags ----
      const nodeGeo = new THREE.RingGeometry(0.42, 0.62, 32).rotateX(-Math.PI / 2)
      for (let i = 0; i < SPOTS.length; i++) {
        const m = new THREE.Mesh(
          nodeGeo,
          new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.chalk).multiplyScalar(1.05), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
        )
        m.position.set(spotV[i].x, 0.03, spotV[i].z)
        m.renderOrder = 5
        nodes.push(m)
        group.add(m)
      }
      for (let i = 0; i < PROCESS.length; i++) {
        const a = spotV[i]
        const b = spotV[i + 1]
        const arc = new PlayArc(a, b, 0.3 * Math.abs(b.x - a.x), { segments: mobile ? 64 : 96 })
        arcs.push(arc)
        group.add(arc.group)
        const lab = new TurfText(pad(i + 1), PROCESS[i].title.toUpperCase(), { width: 13, px: mobile ? 128 : 256 })
        labels.push(lab)
        group.add(lab.mesh)
        const chip = chipTexture(`+${GAINS[i]}`, i === 3 ? 'YDS · TD' : 'YDS', mobile)
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: chip.tex, transparent: true, depthWrite: false }))
        sp.scale.set(2.3 * chip.aspect, 2.3, 1)
        sp.position.copy(arc.apex).add(tmpV.set(0, 2.4, 0))
        sp.renderOrder = 8
        tags.push(sp)
        group.add(sp)
      }
      await nextFrame()

      // ---- the video board graphic ----
      board = boardCanvas(mobile)
      onFonts(() => {
        drawStatsBoard(board.ctx, board.W, board.H, BOARD_STATS, '4 PLAYS · 80 YDS · TOUCHDOWN')
        board.tex.needsUpdate = true
      })
      ready = true
    },

    update(local, frame, ctx) {
      if (!ready) return
      rm = ctx.reducedMotion
      const idle = !rm && !frame.still
      const t = frame.time
      const portrait = isPortrait(frame)
      const b = beat(local, PROCESS.length, A0, A1)

      // ---------------- DOM ----------------
      const out = 1 - smoothstep(0.955, 0.975, local)
      // on portrait (and short landscape) the stats sheet needs the room: the title steps aside for it
      const tight = portrait || frame.height < 520
      const headOn = smoothstep(0.03, 0.065, local) * out * (tight ? 1 - smoothstep(0.785, 0.81, local) : 1)
      reveal(head, headOn, 0)
      setRise(title, local > 0.035 && local < 0.955 && !(tight && local > 0.8))
      reveal(scrim, smoothstep(0.02, 0.07, local) * out, 0)
      reveal(panel, smoothstep(0.07, 0.095, local) * (1 - smoothstep(0.765, 0.785, local)), 12)
      reveal(stats, smoothstep(0.805, 0.84, local) * out, 12)
      const idx = local < A0 ? 0 : b.idx
      if (idx !== shown) {
        shown = idx
        stepNum.textContent = `Step ${pad(idx + 1)} / ${pad(PROCESS.length)}`
        stepTitle.textContent = PROCESS[idx].title
        stepText.textContent = PROCESS[idx].text
        flip = !flip
        swap.classList.toggle('is-a', flip)
        swap.classList.toggle('is-b', !flip)
      }

      // ---------------- the drive ----------------
      let done = 0
      let flying = -1
      for (let i = 0; i < 4; i++) {
        fl[i] = flight(i, local)
        ky[i] = keyed(i, local)
        if (fl[i] >= 1) done = i + 1
        else if (fl[i] > 0 && flying < 0) flying = i
      }
      // the lower third's drive tracker follows the ball
      const ballYd = flying >= 0 ? lerp(SPOTS[flying].yd, SPOTS[flying + 1].yd, fl[flying]) : SPOTS[done].yd
      const fillW = (((Math.min(ballYd, 110) - SPOTS[0].yd) / 120) * 100).toFixed(1)
      if (fillW !== fillShown) {
        fillShown = fillW
        fill.style.width = `${fillW}%`
        dot.style.left = `${(((Math.min(ballYd, 110) + 10) / 120) * 100).toFixed(1)}%`
      }
      if (done !== capShown) {
        capShown = done
        const yds = SPOTS[done].yd - SPOTS[0].yd
        cap.textContent =
          done === 0
            ? '1st & 10 · Own 20'
            : `Drive · ${done} play${done > 1 ? 's' : ''} · ${Math.min(80, yds)} yds${done === 4 ? ' · Touchdown' : ''}`
      }

      // arcs: the current play bright, earlier plays dimmed; the chart holds through the board shot
      for (let i = 0; i < 4; i++) {
        const next = i < 3 ? fl[i + 1] : 0
        const live = 1 - clamp(next * 2.5)
        const glint = idle && flying < 0 && i === done - 1 ? ((t * 0.2 + i * 0.37) % 1) * 1.5 - 0.25 : -1
        arcs[i].set(fl[i], 1, live, fl[i] > 0 && fl[i] < 1 ? 1 : 0, glint)
        // the step name keys onto the turf as the play lands
        const lx = (spotV[i].x + spotV[i + 1].x) / 2
        labels[i].set(i === 3 ? Math.min(lx, 40) : lx, portrait ? 7.4 : 9.8, ky[i] * (0.42 + 0.58 * live))
        // earlier chips darken rather than fade, so the yard numbers never show through them
        const tagOn = smoothstep(0.85, 1, fl[i])
        tags[i].material.opacity = tagOn
        tags[i].material.color.setScalar(0.55 + 0.45 * live)
        tags[i].visible = tagOn > 0.002
      }
      for (let j = 0; j < nodes.length; j++) {
        const reached = j === 0 ? smoothstep(0.02, 0.07, local) : smoothstep(0.9, 1, fl[j - 1])
        const m = nodes[j].material as THREE.MeshBasicMaterial
        m.opacity = reached * 0.85
        nodes[j].visible = reached > 0.002
      }

      // scrimmage + first-down lines: paint on in the intro, move up after each landing, gone on the score
      let losYd = SPOTS[0].yd
      for (let i = 0; i < 3; i++) losYd += (SPOTS[i + 1].yd - SPOTS[i].yd) * ky[i]
      const drawOn = rm ? 1 : smoothstep(0.03, 0.085, local)
      const linesOn = 1 - ky[3]
      los.set(losYd, linesOn * 0.95, drawOn)
      fd.set(losYd + 10, linesOn, drawOn)
      const ddOn = drawOn * linesOn * (flying >= 0 ? 1 - smoothstep(0, 0.12, fl[flying]) * (1 - smoothstep(0.88, 1, fl[flying])) : 1)
      dd.set(yardX(losYd) + 15, -12.5, ddOn * 0.95)

      // the ball: in the air along the current arc, else hovering over its spot
      if (flying >= 0) {
        const u = fl[flying]
        const curve = arcs[flying].curve
        curve.getPointAt(u, ball.position)
        curve.getTangentAt(u, tan)
        qa.setFromUnitVectors(X, tan.normalize())
        qb.setFromAxisAngle(X, u * Math.PI * 7)
        ball.quaternion.copy(qa).multiply(qb)
      } else {
        const s = spotV[done]
        const bob = idle ? Math.sin(t * 1.7) * 0.12 : 0
        ball.position.set(s.x, s.y + bob, s.z)
        eul.set(idle ? Math.sin(t * 0.9) * 0.08 : 0, idle ? Math.sin(t * 0.45) * 0.12 : 0, 0.14)
        ball.quaternion.setFromEuler(eul)
      }
      const introBall = rm ? 1 : smoothstep(0.015, 0.05, local)
      ball.visible = introBall > 0.01
      const hgt = ball.position.y
      const ss = 1.3 + hgt * 0.12
      shadow.scale.set(ss * 1.5, 1, ss)
      shadow.position.x = ball.position.x
      shadow.position.z = ball.position.z
      shadowMat.opacity = introBall * 0.55 * clamp(1.6 / (0.6 + hgt))
      // the spot marker under the ball (off while the ball is in the air)
      const air = flying >= 0 ? Math.min(smoothstep(0, 0.15, fl[flying]), 1 - smoothstep(0.8, 1, fl[flying])) : 0
      const spot = flying >= 0 && fl[flying] > 0.5 ? spotV[flying + 1] : spotV[done]
      puck.set(spot.x, spot.z, { on: introBall * (1 - air), hot: 1, tag: 0, pillar: 1 })

      // ---------------- world + post ----------------
      const W = ctx.world.params
      // the board's stats wipe in as the camera arrives
      if (local > 0.765) {
        W.boardMain = board.tex
        W.boardRect.set(0, 0, 1, 1)
        W.boardMainOn = 1
        W.boardWipe = rm ? 1 : smoothstep(0.79, 0.845, local)
      }
      // the touchdown: phone lights come up around the bowl and stay for the board
      W.phones = 0.7 * ky[3]
      // a touch less of the midfield mark so the chart reads over it
      W.mark = 0.8
      // a whole number of ribbon repeats around the bowl, so its seam (at the
      // east end, right under the board) doesn't cut a word in half
      W.ribbonRepeat = RIBBON_REPEAT
      // a whip smear only while the camera is swinging up to the board fast
      const whip = smoothstep(0.765, 0.785, local) * (1 - smoothstep(0.82, 0.84, local))
      ctx.post.params.glitch = Math.min(0.45, Math.abs(frame.velocity) * 0.3) * whip
    },

    camera(local, frame, out: CameraPose) {
      const idle = !rm && !frame.still
      const t = frame.time
      // ---- the drive (sideline dolly) ----
      drivePose(pA, camCursor(local), frame)
      // intro: the skycam settles into the all-22 spot from higher and further back
      if (!rm && local < 0.1) {
        const e = ease.outCubic(seg(local, 0, 0.075))
        tmpV.subVectors(pA.position, pA.target)
        pA.position.copy(pA.target).addScaledVector(tmpV, 1 + 0.45 * (1 - e))
        pA.position.y += 14 * (1 - e)
        pA.position.x -= 10 * (1 - e)
      }
      // slow push-in while each play sits at rest
      if (!rm && local >= A0 && local < A1) {
        const ph = (local - A0) / SPAN - Math.floor((local - A0) / SPAN)
        const k = 1 - 0.035 * smoothstep(CAM[1], 1, ph)
        tmpV.subVectors(pA.position, pA.target)
        pA.position.copy(pA.target).addScaledVector(tmpV, k)
      }
      // step 4 widens into the whole drive (landscape; portrait is too narrow for 84 yards)
      if (!isPortrait(frame) && local > 0.705) {
        const w = rm ? (local >= 0.73 ? 1 : 0) : ease.inOutCubic(seg(local, 0.712, 0.768))
        if (w > 0) {
          summaryPose(pB, frame)
          pA.position.lerp(pB.position, w)
          pA.target.lerp(pB.target, w)
          pA.fov = lerp(pA.fov, pB.fov, w)
        }
      }
      // ---- the board ----
      if (local > 0.74) {
        boardPose(pB, frame)
        // push in on the board, faster into the stinger
        const push = rm ? 0 : 0.05 * smoothstep(0.84, 0.95, local) + 0.22 * ease.inCubic(seg(local, 0.95, 1))
        tmpV.subVectors(pB.position, pB.target)
        pB.position.copy(pB.target).addScaledVector(tmpV, 1 - push)
        const k = rm ? (local >= 0.785 ? 1 : 0) : ease.inOutCubic(seg(local, 0.765, 0.835))
        // jib: rise through the move, the target pans up to the board
        pC.position.lerpVectors(pA.position, pB.position, k)
        pC.position.y += Math.sin(Math.PI * k) * 16
        pC.target.lerpVectors(pA.target, pB.target, rm ? k : ease.inOutQuad(seg(local, 0.765, 0.83)))
        pC.fov = lerp(pA.fov, pB.fov, k)
        out.position.copy(pC.position)
        out.target.copy(pC.target)
        out.fov = pC.fov
      } else {
        out.position.copy(pA.position)
        out.target.copy(pA.target)
        out.fov = pA.fov
      }
      if (idle) {
        out.position.x += Math.sin(t * 0.21) * 0.5
        out.position.y += Math.sin(t * 0.17 + 1) * 0.3
      }
      out.parallax = 1.2
    },
  }
}
