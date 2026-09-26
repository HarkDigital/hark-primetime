import * as THREE from 'three'
import type { CameraPose, Chapter, Frame } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { SECURITY, STATS } from '../../content'
import { clamp, damp, ease, lerp, rng, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { ArLabel, ArLine, Puck, Route, arMaterial, circlePath, ribbonGeometry } from '../../kit/ar'
import { createFootball } from '../../kit/props'
import { FIELD, PALETTE } from '../../kit/field'
import { isPortrait } from '../../kit/cams'
import { RIBBON_YARDS, onWatchBoard, redZoneBoard, redZoneRibbon } from './graphics'
import { ShieldWall } from './wall'
import './shield.css'

/*
 * SHIELD — "Goal-Line Stand" (Security).
 *
 * The hack is a red-zone threat; Hark is the goal-line stand.
 *   0.00–0.35  THREAT. The offense (red pucks) is at the east 1, driving at
 *              the goal line under the video board. The field takes a red
 *              cast, a red AR line sits on the goal line, the board and the
 *              LED ribbon read RED ZONE. Low camera behind the offense, a
 *              slow push, a barely-there handheld sway (never under reduced
 *              motion / Motion off). The only pulses are slow (0.5 Hz) glows.
 *   0.35–0.50  "HACKED? BREATHE." The defense snaps into a wall on the goal
 *              line (white → first-down yellow), an AR shield rises sideline
 *              to sideline, the red drains out of the field, the ribbon and
 *              the board (the Hark graphic wipes over RED ZONE), the offense
 *              is pushed back. Copy settles by 0.45 (the nav landing).
 *   0.50–0.70  HELD. The camera jibs up and round to the side: the wall
 *              holds, the ball is stopped short at the 1, STOPPED on the turf.
 *   0.70–0.95  ALWAYS ON. The board wipes to a calm 24/7 play clock; the
 *              lower third carries 24/7 + its label + the emergency CTA.
 */

const RED = PALETTE.red
const GOAL_X = FIELD.halfLength // 50
const BALL_X = GOAL_X - 1 // the 1-yard line

// the offense in a heavy goal-line set (x = depth behind the ball, z across)
const OFFENSE: [number, number][] = [
  [0.65, 0], // C
  [0.65, -1.3],
  [0.65, 1.3], // guards
  [0.65, -2.6],
  [0.65, 2.6], // tackles
  [0.65, 3.9], // TE
  [0.65, -3.9], // TE
  [1.8, 0], // QB
  [3.4, 0.4], // FB
  [5.2, 0], // RB
  [0.65, -12.5], // WR split wide
]
const D_COUNT = 11

/** Camera keys: [local, px, py, pz, tx, ty, tz, fov, tangentScale?] */
type Key = number[]
const KEYS_LAND: Key[] = [
  [0.0, 26, 3.2, 3, 62, 9, -1, 46],
  [0.18, 30, 3.4, 5, 61, 8, -1.5, 45],
  [0.33, 34, 4.6, 13, 55, 1.4, -3.5, 41],
  [0.45, 33, 4, 19, 56, 3.5, -8, 40, 0.3],
  [0.62, 31, 14, 27, 51, 1.2, -1, 42],
  [0.8, 4, 25, 30, 72, 18, -10, 47],
  [1.0, 0, 26, 30.5, 73, 19, -10, 47],
]
const KEYS_PORT: Key[] = [
  [0.0, 24, 3.2, 3, 70, 12.5, 1.5, 58],
  [0.18, 27, 3.5, 5, 68, 10.5, 1, 57],
  [0.33, 35, 5.2, 12, 54, 1.8, -2.5, 55],
  [0.45, 21, 7.5, 22, 55, 9, -9.5, 58, 0.3],
  [0.62, 24, 18, 33, 51, 7, -2, 56],
  [0.8, 20, 18, 30, 78, 17.5, -2, 56],
  [1.0, 17, 19, 31, 79, 18.5, -2, 56],
]

function tangent(keys: Key[], i: number, c: number) {
  if (i <= 0 || i >= keys.length - 1) return 0
  const a = keys[i - 1]
  const b = keys[i + 1]
  return ((b[c] - a[c]) / (b[0] - a[0])) * (keys[i][8] ?? 1)
}
/** Hermite basis at u, reused (no per-frame allocation). */
const H = [0, 0, 0, 0]
function herm(keys: Key[], i: number, dt: number, c: number) {
  return H[0] * keys[i][c] + H[1] * dt * tangent(keys, i, c) + H[2] * keys[i + 1][c] + H[3] * dt * tangent(keys, i + 1, c)
}
/** Non-uniform Catmull-Rom (Hermite) through the keys; writes pos/target, returns fov. */
function samplePath(keys: Key[], t: number, pos: THREE.Vector3, tgt: THREE.Vector3) {
  let i = 0
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++
  const dt = keys[i + 1][0] - keys[i][0]
  const u = clamp((t - keys[i][0]) / dt)
  const u2 = u * u
  const u3 = u2 * u
  H[0] = 2 * u3 - 3 * u2 + 1
  H[1] = u3 - 2 * u2 + u
  H[2] = -2 * u3 + 3 * u2
  H[3] = u3 - u2
  pos.set(herm(keys, i, dt, 1), herm(keys, i, dt, 2), herm(keys, i, dt, 3))
  tgt.set(herm(keys, i, dt, 4), herm(keys, i, dt, 5), herm(keys, i, dt, 6))
  return herm(keys, i, dt, 7)
}

/** A soft wide glow strip on the turf along the goal line. */
function glowStrip(color: string, width: number, x: number) {
  const { geometry, length } = ribbonGeometry([new THREE.Vector2(x, -FIELD.halfWidth), new THREE.Vector2(x, FIELD.halfWidth)], width, 0.022)
  const material = arMaterial({ color, glow: 1, opacity: 0.3, soft: 0.5 })
  material.uniforms.uLen.value = length
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 3
  mesh.frustumCulled = false
  return { mesh, material }
}

export default function create(): Chapter {
  const group = new THREE.Group()
  const stat = STATS.find(s => s.value === '24/7')!

  // --- scene -------------------------------------------------------------
  const offense = OFFENSE.map(() => new Puck({ color: RED, hot: RED, radius: 0.6, pillar: 3 }))
  const defense = Array.from({ length: D_COUNT }, () => new Puck({ color: PALETTE.chalk, hot: PALETTE.yellow, radius: 0.6, pillar: 3.4 }))
  // the defense on its heels (scattered in the end zone) → the wall on the goal line
  const rand = rng(24)
  const lineZ = defense.map((_, i) => -11 + (22 * i) / (D_COUNT - 1))
  const scatter = defense.map((_, i) => [GOAL_X + 1.6 + rand() * 5, lineZ[i] * 1.2 + (rand() - 0.5) * 5] as [number, number])
  const order = defense.map((_, i) => Math.abs(i - (D_COUNT - 1) / 2))

  const redLine = new ArLine({ color: RED, width: 0.5, glow: 1.5 })
  const yellowLine = new ArLine({ color: PALETTE.yellow, width: 0.42, glow: 1.45 })
  const redGlow = glowStrip(RED, 3.2, GOAL_X)
  const yellowGlow = glowStrip(PALETTE.yellow, 3.6, GOAL_X + 0.2)
  const wall = new ShieldWall({ height: 3.6, x: GOAL_X + 0.3 })
  const ball = createFootball()
  const BALL_S = 2.6
  ball.scale.setScalar(BALL_S)
  ball.position.set(BALL_X + 0.05, 0.094 * BALL_S, 0.35)
  ball.rotation.y = 0.32
  const stopped = new ArLabel('STOPPED', { width: 7.5, color: PALETTE.yellow, up: '-z', glow: 1.25 })
  // the analyst circles the ball, stopped short of the line
  const ring = new Route(circlePath(BALL_X - 0.1, 0.35, 1.7, 7), { width: 0.2, color: PALETTE.yellow, glow: 1.3, chalk: 0.5, arrow: false })

  group.add(redGlow.mesh, yellowGlow.mesh, redLine.mesh, yellowLine.mesh, wall.mesh, ball, stopped.mesh, ring.group)
  for (const p of offense) group.add(p.group)
  for (const p of defense) group.add(p.group)

  // board + ribbon graphics (built in init)
  let redBoard: THREE.Texture | null = null
  let watchBoard: THREE.Texture | null = null
  let redRibbon: THREE.Texture | null = null
  const tint = new THREE.Color()
  const WHITE = new THREE.Color('#ffffff')
  const RED_CAST = new THREE.Color('#ffa699')
  const FULL = new THREE.Vector4(0, 0, 1, 1)

  // one options object for Puck.set (no per-frame allocation)
  const opt = { on: 1, hot: 0, tag: 0, pillar: 1 }

  // time-damped display values (pace bright changes by time, not scroll)
  let wallShown = 0

  // --- DOM ---------------------------------------------------------------
  let scrim: HTMLElement, scrimCalm: HTMLElement, bug: HTMLElement, copy: HTMLElement, eyebrow: HTMLElement, title: HTMLElement, body: HTMLElement, calm: HTMLElement
  let bugLive = false

  return {
    id: 'shield',
    group,
    anchors: [0.8],
    async init(ctx) {
      const s = ctx.stage
      scrim = el('div', 'sh-scrim', undefined, s)
      scrimCalm = el('div', 'sh-scrim sh-scrim--calm', undefined, s)
      bug = el('div', 'sh-bug', undefined, s)
      const tag = el('span', 'sh-bug-tag', undefined, bug)
      el('i', 'sh-bug-dot', undefined, tag)
      el('span', 'sh-bug-word', 'Red zone', tag)
      el('span', 'sh-bug-down', '1st & goal · Ball on the 1', bug)

      copy = el('div', 'sh-copy', undefined, s)
      eyebrow = el('p', 'hud-eyebrow', SECURITY.eyebrow, copy)
      title = rise(el('h2', 'hud-title sh-title', undefined, copy), 'Hacked? <em>Breathe.</em>')
      body = el('div', 'sh-body hud-panel', undefined, copy)
      el('p', 'hud-body', SECURITY.body, body)

      calm = el('div', 'sh-calm hud-panel', undefined, s)
      el('p', 'hud-label sh-calm-label', 'Goal-line stand · On watch', calm)
      el('p', 'sh-247', stat.value, calm)
      el('p', 'hud-body sh-calm-body', stat.label, calm)
      const cta = el('a', 'hud-btn sh-cta', SECURITY.cta, calm)
      cta.href = SECURITY.href

      await nextFrame()
      redBoard = redZoneBoard(ctx.mobile)
      await nextFrame()
      watchBoard = onWatchBoard(ctx.mobile)
      redRibbon = redZoneRibbon(ctx.mobile)
    },

    update(local, frame, ctx) {
      const motion = frame.reducedMotion || frame.still ? 0 : 1
      const t = frame.time
      // a slow alarm glow (0.5 Hz), flat under reduced motion / Motion off
      const pulse = motion ? 0.5 + 0.5 * Math.sin(t * Math.PI) : 0.6
      const threat = 1 - smoothstep(0.34, 0.42, local)

      // --- offense: creeping at the 1, then driven back and gone
      const surge = ease.inOutQuad(segment(local, 0.0, 0.33))
      const back = ease.outCubic(segment(local, 0.37, 0.5))
      const oOn = 1 - smoothstep(0.4, 0.62, local)
      const oDim = 1 - 0.55 * smoothstep(0.38, 0.48, local)
      opt.on = oOn * oDim
      opt.hot = 0.35 + 0.35 * pulse * threat
      opt.pillar = 0.8 + 0.2 * threat
      for (let i = 0; i < OFFENSE.length; i++) {
        const dx = OFFENSE[i][0]
        const x = BALL_X - dx - 1.1 * (1 - surge) - back * (2.6 + dx * 0.25)
        offense[i].set(x, OFFENSE[i][1], opt)
      }

      // --- defense: scattered → the wall (centre first, a snap with a little overshoot)
      const push = ease.outCubic(segment(local, 0.42, 0.5))
      const lx = GOAL_X - 0.15 - push * 0.35
      for (let i = 0; i < D_COUNT; i++) {
        const k = segment(local, 0.35 + order[i] * 0.006, 0.41 + order[i] * 0.006)
        const snap = ease.outBack(k)
        opt.on = lerp(0.55, 1, k)
        opt.hot = smoothstep(0.2, 1, k)
        opt.pillar = lerp(0.4, 1, k)
        defense[i].set(lerp(scatter[i][0], lx, snap), lerp(scatter[i][1], lineZ[i], clamp(snap)), opt)
      }

      // --- the goal line: red AR under threat, yellow once the stand is set
      redLine.set(100, threat * (0.8 + 0.2 * pulse), segment(local, 0.02, 0.12))
      redGlow.material.uniforms.uOpacity.value = 0.34 * threat * (0.75 + 0.25 * pulse) * segment(local, 0.02, 0.12)
      redGlow.mesh.visible = threat > 0.002
      const rise01 = ease.outCubic(segment(local, 0.36, 0.44))
      yellowLine.set(100, 1, segment(local, 0.355, 0.42))
      const wallTarget = local < 0.355 ? 0 : 1 - 0.25 * smoothstep(0.7, 0.8, local)
      wallShown = damp(wallShown, wallTarget, 6, frame.dt)
      wall.set(rise01, wallShown, t, 0.9 * motion)
      yellowGlow.material.uniforms.uOpacity.value = 0.26 * rise01 * wallShown
      yellowGlow.mesh.visible = rise01 * wallShown > 0.002

      // --- the ball stays short of the line; STOPPED once the stand holds
      const held = 1 - smoothstep(0.74, 0.8, local)
      stopped.set(BALL_X - 4.2, 6, smoothstep(0.5, 0.56, local) * held)
      ring.set(ease.inOutQuad(segment(local, 0.5, 0.58)), held)

      // --- the world: red zone → calm
      const w = ctx.world.params
      tint.copy(WHITE).lerp(RED_CAST, threat)
      w.tint = tint
      w.stands = 1 - 0.18 * threat - 0.08 * smoothstep(0.36, 0.44, local) * (1 - smoothstep(0.7, 0.8, local))
      w.crowdMotion = lerp(0.35, 1, 1 - smoothstep(0.66, 0.76, local))
      // ribbon: RED ZONE crawl, dipped while it swaps back to the house crawl
      const swap = local < 0.38
      w.ribbon = swap ? redRibbon : null
      if (swap) {
        w.ribbonRepeat = RIBBON_YARDS
        w.ribbonScroll = t * 0.02 * motion + local * 1.5
      }
      w.ribbonLevel = 1 - 0.8 * (smoothstep(0.3, 0.37, local) * (1 - smoothstep(0.39, 0.46, local)))
      // board: RED ZONE (slow breathing) → the Hark graphic wipes over it → 24/7 wipes in
      w.boardMainOn = 1
      if (local < 0.35) {
        w.boardBg = redBoard
        w.boardLevel = 0.9 + 0.1 * pulse
      } else if (local < 0.42) {
        w.boardBg = redBoard
        w.boardMain = ctx.world.board.bgDefault
        w.boardRect.copy(FULL)
        w.boardWipe = ease.inOutQuad(segment(local, 0.35, 0.41))
      } else if (local < 0.68) {
        w.boardBg = null
      } else {
        w.boardBg = null
        w.boardMain = watchBoard
        w.boardRect.copy(FULL)
        w.boardWipe = ease.inOutQuad(segment(local, 0.68, 0.74))
      }

      // post: a touch more vignette in the red zone
      ctx.post.params.vignette = 0.28 + 0.14 * threat

      // --- DOM
      const bugV = smoothstep(0.06, 0.09, local) * (1 - smoothstep(0.3, 0.34, local))
      reveal(bug, bugV, 0)
      if (bugV > 0.01 !== bugLive) {
        bugLive = bugV > 0.01
        bug.classList.toggle('is-live', bugLive)
      }
      const copyV = smoothstep(0.365, 0.4, local) * (1 - smoothstep(0.66, 0.69, local))
      reveal(copy, copyV, 0)
      reveal(eyebrow, smoothstep(0.365, 0.395, local))
      setRise(title, local > 0.365 && local < 0.69)
      reveal(body, smoothstep(0.375, 0.41, local))
      const calmV = smoothstep(0.71, 0.75, local) * (1 - smoothstep(0.93, 0.96, local))
      reveal(calm, calmV, 18)
      reveal(scrim, copyV, 0)
      reveal(scrimCalm, calmV, 0)
    },

    onLeave() {
      // the RED ZONE bug's alarm restarts (five beats) the next time it appears
      bugLive = false
      bug?.classList.remove('is-live')
    },

    camera(local, frame: Frame, out: CameraPose) {
      const port = isPortrait(frame)
      out.fov = samplePath(port ? KEYS_PORT : KEYS_LAND, local, out.position, out.target)
      const threat = 1 - smoothstep(0.34, 0.42, local)
      // an extremely subtle handheld sway in the red zone (none under reduced motion / Motion off)
      if (!frame.reducedMotion && !frame.still) {
        const t = frame.time
        const s = threat * 0.06
        out.position.x += Math.sin(t * 0.61) * s
        out.position.y += Math.sin(t * 0.83 + 1.3) * s * 0.6
        out.target.y += Math.sin(t * 0.47 + 0.4) * s * 0.8
      }
      out.roll = -0.016 * threat
      out.parallax = 0.35
    },
  }
}
