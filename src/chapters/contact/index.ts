import * as THREE from 'three'
import type { Chapter, ChapterContext } from '../../core/types'
import { el, rise, setRise, reveal } from '../../core/dom'
import { BRAND, CONTACT, OTHER_CONCEPTS } from '../../content'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { ArLine } from '../../kit/ar'
import { createFootball } from '../../kit/props'
import { FIELD } from '../../kit/field'
import { onFonts } from '../../kit/type'
import { finalBoard, helloBoard, ribbonTexture, touchdownBoard } from './boards'
import { createConfetti } from './confetti'
import { createPlane } from './plane'
import { createTracer } from './tracer'
import { fitShot } from './fit'
import './contact.css'

/*
 * TOUCHDOWN (contact, the final chapter). The drive ends in the EAST end zone,
 * under the video board.
 *
 *   0.00–0.18  THE SCORE   a low goal-line camera: the ball spirals in, breaks
 *                          the AR plane on the goal line and touches down on
 *                          the HARK paint; the board wipes to TOUCHDOWN, the
 *                          crowd erupts (phones, the wave), confetti starts
 *   0.18–0.30  SETTLE      a jib rise into a composed shot of the end zone:
 *                          HARK, the posts, the board ("SAY HELLO" + the
 *                          email); the contact copy rises in (settled by 0.3)
 *   0.30–0.85  CONTACT     everything readable and clickable; a slow push
 *   0.85–1.00  FINAL       the board wipes to FINAL · HARK.DIGITAL · THANKS
 *                          FOR LISTENING, one light bank eases down, the
 *                          sign-off appears; the copy stays (the page ends)
 *
 * Contact block behaviours (kept from the starter): the big email CTA wins
 * hit-testing at every viewport, Copy email (clipboard + execCommand
 * fallback, "Copied" / "Copy failed"), every sister concept (new tab), Back to
 * top → land('hero'), the footer, and "Thanks for listening." near the end.
 */

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

/** The story beats (local progress). */
const T = {
  ballFrom: 0.02,
  land: 0.145,
  rest: 0.205,
  tdWipe: [0.117, 0.136],
  helloWipe: [0.255, 0.285],
  finalWipe: [0.855, 0.89],
  jib: [0.15, 0.3],
  copy: [0.19, 0.265],
  push: [0.3, 0.86],
  final: [0.85, 0.94],
  signoff: [0.87, 0.93],
} as const

/** The pass: from over the camera's shoulder down onto the HARK paint. */
const BALL_SCALE = 2.6
const BALL_R = 0.094 * BALL_SCALE
const P0 = new THREE.Vector3(34, 6.8, 12.5)
const P1 = new THREE.Vector3(54.8, BALL_R + 0.05, 4.4)
const ARC = 3.2
const SKID = new THREE.Vector3(1.4, 0, -0.45)
/** heading (rotation.y) in flight and at rest */
const FLIGHT_YAW = Math.atan2(-(P1.z - P0.z), P1.x - P0.x)
const REST_YAW = Math.atan2(-1, 0.3)
/** flight parameter where the ball crosses the goal line (x = 50) */
const T_CROSS = (FIELD.halfLength - P0.x) / (P1.x - P0.x)
const L_CROSS = T.ballFrom + T_CROSS * (T.land - T.ballFrom)

/** the composed camera never backs further than this from the end zone (the west stands) */
const D_MAX = 138

const _X = new THREE.Vector3(1, 0, 0)
const _Y = new THREE.Vector3(0, 1, 0)

function ballPos(t: number, out: THREE.Vector3) {
  return out.set(lerp(P0.x, P1.x, t), lerp(P0.y, P1.y, t) + ARC * 4 * t * (1 - t), lerp(P0.z, P1.z, t))
}
function ballVel(t: number, out: THREE.Vector3) {
  return out.set(P1.x - P0.x, P1.y - P0.y + ARC * 4 * (1 - 2 * t), P1.z - P0.z)
}

/** A soft contact shadow for the ball (grey on black → alphaMap reads green). */
function shadowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.5, '#6a6a6a')
  g.addColorStop(1, '#000000')
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export default function create(): Chapter {
  const group = new THREE.Group()
  group.name = 'contact'

  // ---- the ball ----
  const ballPivot = new THREE.Group()
  const ball = createFootball()
  ball.scale.setScalar(BALL_SCALE)
  ballPivot.add(ball)
  group.add(ballPivot)
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: shadowTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  })
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat)
  shadow.renderOrder = 3
  group.add(shadow)

  // ---- AR: the goal line and the plane ----
  const goal = new ArLine({ width: 0.34, glow: 1.25 })
  group.add(goal.mesh)
  const plane = createPlane()
  group.add(plane.mesh)
  // where the ball breaks the plane (z, y)
  const contact = ballPos(T_CROSS, new THREE.Vector3())
  // the ball tracer along the flight, and arc length → head position
  const N = 64
  const flightPts: THREE.Vector3[] = []
  const cum: number[] = [0]
  for (let i = 0; i <= N; i++) {
    flightPts.push(ballPos(i / N, new THREE.Vector3()))
    if (i > 0) cum.push(cum[i - 1] + flightPts[i].distanceTo(flightPts[i - 1]))
  }
  const tracer = createTracer(flightPts)
  group.add(tracer.mesh)
  const headAt = (t: number) => {
    const f = clamp(t) * N
    const i = Math.min(N - 1, Math.floor(f))
    return lerp(cum[i], cum[i + 1], f - i) / cum[N]
  }

  // ---- per-frame scratch (no allocations in update/camera) ----
  const vP = new THREE.Vector3()
  const vV = new THREE.Vector3()
  const qFly = new THREE.Quaternion()
  const qRest = new THREE.Quaternion()
  const qRoll = new THREE.Quaternion()
  // it comes to rest side-on to the composed shot (a football reads as a football)
  const restDir = new THREE.Vector3(Math.cos(REST_YAW), 0, -Math.sin(REST_YAW))
  qRest.setFromUnitVectors(_X, restDir)
  // lying on its side: the laces roll over toward the camera
  qRest.multiply(qRoll.setFromAxisAngle(_X, -1.15))
  const qLand = new THREE.Quaternion().setFromUnitVectors(_X, ballVel(1, vV).normalize())

  // camera scratch
  const poseTD = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }
  const poseC = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 }
  const cDir = new THREE.Vector3()
  const cRight = new THREE.Vector3()
  const cUp = new THREE.Vector3()
  const anchor = new THREE.Vector3(80, 18, 0)
  // what the composed shot must hold: the board's top corners and the front of the HARK paint
  const KEYS = [
    new THREE.Vector3(108, 50, 29),
    new THREE.Vector3(108, 50, -29),
    new THREE.Vector3(50.8, 0, 17),
    new THREE.Vector3(50.8, 0, -17),
  ]
  // portrait bands are short: frame the board (the email on it) and let the paint run under the card
  const KEYS_TALL = [
    new THREE.Vector3(108, 50, 29),
    new THREE.Vector3(108, 50, -29),
    new THREE.Vector3(108, 25.8, 29),
    new THREE.Vector3(108, 25.8, -29),
  ]
  const fitRect = { x0: 0, x1: 0, y0: 0, y1: 0 }

  // the scene's free screen rect (NDC), measured from the copy layout on resize
  const band = { x0: 0, x1: 0.95, y0: -0.7, y1: 0.7, signoff: 0.1 }

  let confetti: ReturnType<typeof createConfetti> | null = null
  let tdTex: THREE.Texture
  let helloTex: THREE.Texture
  let finalTex: THREE.Texture
  let ribbonTD: ReturnType<typeof ribbonTexture>
  let ribbonFinal: ReturnType<typeof ribbonTexture>
  let bgDefault: THREE.Texture
  let rm = false

  // DOM
  let copy: HTMLElement, head: HTMLElement, card: HTMLElement, title: HTMLElement, eyebrow: HTMLElement
  let scrim: HTMLElement, signoff: HTMLElement
  let stage: HTMLElement | null = null

  const measure = () => {
    if (!stage) return
    const w = stage.clientWidth || window.innerWidth
    const h = stage.clientHeight || window.innerHeight
    if (!w || !h) return
    const nx = (px: number) => (px / w) * 2 - 1
    const ny = (py: number) => 1 - (py / h) * 2
    // offset metrics ignore the reveal transforms; the copy column spans the
    // chrome's safe area, starting at the gutter
    const cl = copy.offsetLeft
    const ct = copy.offsetTop
    const gutter = Math.max(8, cl)
    const headBottom = ct + head.offsetTop + head.offsetHeight
    const cardTop = ct + card.offsetTop
    // landscape: the sign-off sits over the scene (bottom right); the final
    // wide shot leaves room for it
    band.signoff = (signoff.offsetHeight + 22) / (h / 2)
    if (h > w) {
      // portrait: between the headline block and the card
      let top = headBottom + 6
      let bottom = cardTop - 6
      // a very short band (small phones) still gets a sliver of scene
      const min = Math.max(64, h * 0.1)
      if (bottom - top < min) {
        const mid = (top + bottom) / 2
        top = mid - min / 2
        bottom = mid + min / 2
      }
      band.x0 = nx(gutter)
      band.x1 = nx(w - gutter)
      band.y1 = ny(top)
      band.y0 = ny(bottom)
    } else {
      band.x0 = nx(Math.min(cl + copy.offsetWidth + 16, w * 0.62))
      band.x1 = nx(w - gutter)
      band.y1 = ny(ct)
      band.y0 = ny(ct + copy.offsetHeight)
    }
  }

  return {
    id: 'contact',
    group,
    async init(ctx: ChapterContext) {
      rm = ctx.reducedMotion
      stage = ctx.stage
      bgDefault = ctx.world.board.bgDefault
      // ---- DOM: scrim, the contact column, the sign-off ----
      scrim = el('div', 'ct-scrim', undefined, stage)
      copy = el('div', 'ct-copy', undefined, stage)
      head = el('div', 'ct-head', undefined, copy)
      eyebrow = el('p', 'hud-eyebrow', CONTACT.eyebrow, head)
      title = rise(el('h2', 'hud-title ct-title', undefined, head), 'Say <em>hello.</em>')
      card = el('div', 'hud-panel ct-card', undefined, copy)
      el('p', 'hud-body ct-body', CONTACT.body, card)
      const ctas = el('div', 'ct-ctas', undefined, card)
      const mail = el('a', 'hud-btn ct-mail', BRAND.email, ctas)
      mail.href = CONTACT.href
      const cp = el('button', 'hud-btn hud-btn--ghost ct-copybtn', 'Copy email', ctas)
      cp.type = 'button'
      let resetTimer = 0
      cp.addEventListener('click', async () => {
        const ok = await copyText(BRAND.email)
        cp.textContent = ok ? 'Copied' : 'Copy failed'
        window.clearTimeout(resetTimer)
        resetTimer = window.setTimeout(() => (cp.textContent = 'Copy email'), 1800)
      })
      const net = el('div', 'ct-net', undefined, card)
      el('p', 'hud-label ct-netlabel', 'Other concepts', net)
      const list = el('ul', 'ct-links', undefined, net)
      for (const c of OTHER_CONCEPTS) {
        const li = el('li', '', undefined, list)
        const a = el('a', '', `${c.name} ↗`, li)
        a.href = c.url
        a.target = '_blank'
        a.rel = 'noopener'
      }
      const foot = el('div', 'ct-foot', undefined, card)
      const top = el('button', 'ct-top', 'Back to top ↑', foot)
      top.type = 'button'
      top.addEventListener('click', () => window.__hark?.land('hero'))
      el('p', 'hud-label ct-legal', `© ${new Date().getFullYear()} ${BRAND.name} · ${BRAND.locale}`, foot)
      signoff = el('div', 'ct-signoff', undefined, stage)
      el('span', 'ct-signoff-tag', 'Final', signoff)
      el('span', 'ct-signoff-text', 'Thanks for listening.', signoff)
      reveal(copy, 0, 0)
      reveal(scrim, 0, 0)
      reveal(signoff, 0)

      // keep the scene's framing in step with the copy layout (never per frame)
      measure()
      window.addEventListener('resize', measure)
      onFonts(measure)
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(measure)
        for (const n of [copy, head, card]) ro.observe(n)
      }

      await nextFrame()
      // ---- board + ribbon graphics (drawn once; again when fonts land) ----
      tdTex = touchdownBoard(ctx.mobile)
      helloTex = helloBoard(ctx.mobile)
      await nextFrame()
      finalTex = finalBoard(ctx.mobile)
      ribbonTD = ribbonTexture(ctx.mobile, ['TOUCHDOWN', 'HARK.DIGITAL', 'TOUCHDOWN', 'SAY HELLO'])
      ribbonFinal = ribbonTexture(ctx.mobile, ['FINAL', 'THANKS FOR LISTENING', 'HARK.DIGITAL', BRAND.locale.toUpperCase()])
      await nextFrame()

      // ---- confetti over the end zone ----
      confetti = createConfetti({
        count: ctx.mobile ? 420 : 900,
        min: new THREE.Vector3(30, -1, -36),
        size: new THREE.Vector3(62, 44, 72),
        piece: ctx.mobile ? 0.5 : 0.42,
      })
      group.add(confetti.mesh)
    },

    update(local, frame, ctx) {
      rm = frame.reducedMotion
      const calm = rm || !!frame.still
      const idle = rm ? 0 : frame.time
      const p = ctx.world.params

      // ---- the ball ----
      const fly = segment(local, T.ballFrom, T.land)
      const settle = segment(local, T.land, T.rest)
      if (local < T.land) {
        ballPos(fly, vP)
        ballVel(fly, vV).normalize()
        ballPivot.position.copy(vP)
        qFly.setFromUnitVectors(_X, vV)
        ballPivot.quaternion.copy(qFly)
        // a tight spiral, ~3.5 turns over the flight
        ball.rotation.set(fly * Math.PI * 7, 0, 0)
      } else {
        const s = ease.outCubic(settle)
        vP.copy(P1).addScaledVector(SKID, s)
        // one short hop off the turf, then it lies still
        vP.y = BALL_R + 0.42 * Math.sin(Math.PI * clamp(settle * 1.8)) * (1 - settle)
        ballPivot.position.copy(vP)
        ballPivot.quaternion.copy(qLand).slerp(qRest, ease.inOutCubic(clamp(settle * 1.25)))
        // the spiral winds down half a turn (7π → 8π ≡ 0: continuous with the flight and the rest pose)
        ball.rotation.set(Math.PI * (7 + s), 0, 0)
      }
      ballPivot.visible = local > T.ballFrom
      // contact shadow: darker and tighter as the ball nears the turf
      const hgt = Math.max(0, ballPivot.position.y - BALL_R)
      shadow.position.set(ballPivot.position.x, 0.02, ballPivot.position.z)
      const sp = 1 + hgt * 0.35
      shadow.scale.set(0.95 * sp, 1, 0.55 * sp)
      shadow.rotation.y = lerp(FLIGHT_YAW, REST_YAW, ease.inOutCubic(clamp(settle * 1.25)))
      shadowMat.opacity = 0.62 * (1 - smoothstep(0, 4, hgt)) * (ballPivot.visible ? 1 : 0)

      tracer.set(headAt(fly), (1 - segment(local, 0.17, 0.235)) * smoothstep(0.02, 0.05, local))

      // ---- AR: goal line + the plane ----
      const arIn = segment(local, 0.045, 0.095)
      const arOut = 1 - segment(local, 0.19, 0.25)
      goal.set(100, arOut, ease.outCubic(arIn))
      const hit = local > L_CROSS ? segment(local, L_CROSS, L_CROSS + 0.045) : 0
      // the sheet lights up around the ball as it closes in, ripples as it breaks through
      const near = local < L_CROSS ? smoothstep(L_CROSS - 0.035, L_CROSS, local) : 1 - segment(local, L_CROSS, L_CROSS + 0.03)
      const bz = local < T.land ? vP.z : P1.z
      const by = local < T.land ? vP.y : P1.y
      plane.set(ease.outCubic(segment(local, 0.055, 0.1)), arOut, hit, contact.z, contact.y, bz, by, near)

      // ---- the crowd erupts ----
      const cele = smoothstep(0.115, 0.16, local)
      const fin = smoothstep(T.final[0], T.final[1], local)
      // phones up for the score, a softer glow while the contact copy is up, up again at the end
      p.phones = cele * (1 - 0.55 * smoothstep(0.24, 0.34, local) + 0.3 * fin)
      p.crowdMotion = 1 + 1.5 * cele * (1 - smoothstep(0.3, 0.5, local))
      p.wave = local > 0.12 ? (((0.92 + (local - 0.12) * 1.6 + idle * 0.035) % 1) + 1) % 1 : -1
      // the end of the broadcast: one bank eases down (never dark), beams soften
      p.lights = 1 - 0.07 * fin
      p.beams = 1 - 0.3 * fin
      p.streaks = 1 - 0.2 * fin

      // ---- the video board: idle → TOUCHDOWN → SAY HELLO → FINAL (broadcast wipes) ----
      p.boardMainOn = 1
      p.boardRect.set(0, 0, 1, 1)
      if (tdTex) {
        if (local < T.tdWipe[0]) {
          p.boardBg = bgDefault
        } else if (local < T.tdWipe[1]) {
          p.boardBg = bgDefault
          p.boardMain = tdTex
          p.boardWipe = segment(local, T.tdWipe[0], T.tdWipe[1])
        } else if (local < T.helloWipe[0]) {
          p.boardBg = tdTex
        } else if (local < T.helloWipe[1]) {
          p.boardBg = tdTex
          p.boardMain = helloTex
          p.boardWipe = segment(local, T.helloWipe[0], T.helloWipe[1])
        } else if (local < T.finalWipe[0]) {
          p.boardBg = helloTex
        } else if (local < T.finalWipe[1]) {
          p.boardBg = helloTex
          p.boardMain = finalTex
          p.boardWipe = segment(local, T.finalWipe[0], T.finalWipe[1])
        } else {
          p.boardBg = finalTex
        }
        // the ribbon joins in once the ball is down, and signs off at the end
        if (local > T.tdWipe[0]) {
          const r = local < T.finalWipe[0] ? ribbonTD : ribbonFinal
          p.ribbon = r.tex
          p.ribbonRepeat = r.repeat
          p.ribbonScroll = local * 0.6 + (calm ? 0 : frame.time * 0.012)
        }
      }

      // ---- confetti: drifts in once the ball is down ----
      if (confetti) {
        const show = smoothstep(0.11, 0.3, local) * (rm ? 0.45 : 1)
        const fall = local * 28 + idle * 1.1
        const tumble = local * 9 + idle * 1.0
        const drop = (1 - ease.outCubic(segment(local, 0.11, 0.34))) * 34
        confetti.set(fall, tumble, show, drop)
      }

      // ---- copy ----
      const copyIn = smoothstep(T.copy[0], T.copy[1], local)
      reveal(scrim, smoothstep(0.16, 0.26, local), 0)
      reveal(copy, copyIn, 0)
      reveal(eyebrow, copyIn)
      reveal(card, smoothstep(T.copy[0] + 0.02, T.copy[1] + 0.01, local))
      setRise(title, local > T.copy[0] + 0.01)
      reveal(signoff, smoothstep(T.signoff[0], T.signoff[1], local))
    },

    camera(local, frame, out) {
      const aspect = frame.width / Math.max(1, frame.height)
      // 0 = tall phone, 1 = landscape
      const land = smoothstep(0.62, 1.25, aspect)

      // ---- THE SCORE: a low goal-line camera looking up at the end zone + board ----
      const dolly = ease.outQuad(segment(local, 0, T.land))
      poseTD.position.set(lerp(42.2, 44, dolly), lerp(2.3, 2.1, dolly), lerp(14.2, 12.8, dolly))
      poseTD.target.set(lerp(69, 70, dolly), lerp(10.6, 11, dolly), lerp(-2, -1.2, dolly))
      poseTD.fov = 54
      // squarer screens (4:3): turn a touch toward the board so TOUCHDOWN stays whole
      poseTD.target.z += 10 * clamp(1.6 - aspect, 0, 0.35) * land
      if (land < 1) {
        // portrait: back and up so the board's TOUCHDOWN fits the width
        const k = 1 - land
        poseTD.position.x -= 16 * k
        poseTD.position.y += 1.2 * k
        poseTD.position.z -= 4 * k
        poseTD.target.y += 0.5 * k
        poseTD.target.z += 7 * k
        poseTD.fov = lerp(54, 66, k)
      }

      // ---- CONTACT: a composed shot of the end zone, framed into the free band ----
      // a slow push in while the copy is up, then the FINAL wide: ease back and
      // lift the end zone clear of the sign-off (settled by 0.94)
      const fin = smoothstep(T.final[0], T.final[1], local)
      const push = ease.inOutCubic(segment(local, T.push[0], T.push[1])) * (1 - 0.7 * fin)
      cDir.set(1, -0.3, -0.2).normalize()
      cRight.crossVectors(cDir, _Y).normalize()
      cUp.crossVectors(cRight, cDir)
      let fov = lerp(50, 40, land)
      // a little air under the top band and above the bottom one
      const tall = frame.height > frame.width
      fitRect.x0 = band.x0 + (tall ? 0.07 : 0.02)
      fitRect.x1 = band.x1 - (tall ? 0.07 : 0.02)
      fitRect.y1 = band.y1 - (tall ? 0.015 : 0.06)
      fitRect.y0 = band.y0 + (tall ? 0.015 : 0.04 + band.signoff * fin)
      const keys = tall ? KEYS_TALL : KEYS
      let D = fitShot(poseC, cDir, keys, fitRect, fov, aspect, anchor)
      // a short band would push the camera out behind the west stands: stay
      // inside the bowl and open the lens instead
      if (D > D_MAX) {
        const tn = (Math.tan(THREE.MathUtils.degToRad(fov) / 2) * D) / D_MAX
        fov = Math.min(78, THREE.MathUtils.radToDeg(2 * Math.atan(tn)))
        D = fitShot(poseC, cDir, keys, fitRect, fov, aspect, anchor, D_MAX)
      }
      // the slow push-in
      poseC.position.addScaledVector(cDir, D * 0.07 * push)
      poseC.target.addScaledVector(cDir, D * 0.07 * push)
      poseC.fov = fov
      // idle breathing on the jib (never under reduced motion / Motion off)
      if (!frame.reducedMotion) {
        const tm = frame.time
        poseC.position.addScaledVector(cRight, Math.sin(tm * 0.13) * 0.35).addScaledVector(cUp, Math.sin(tm * 0.17 + 1) * 0.2)
      }

      // ---- the jib: rise and settle from the low shot into the composed one ----
      const j = ease.inOutCubic(segment(local, T.jib[0], T.jib[1]))
      const arc = Math.sin(Math.PI * j) * 3.5
      out.position.lerpVectors(poseTD.position, poseC.position, j)
      out.position.y += arc
      out.target.lerpVectors(poseTD.target, poseC.target, j)
      out.target.y += arc
      out.fov = lerp(poseTD.fov, poseC.fov, j)
      out.parallax = lerp(0, 0.35, j)
    },
  }
}
