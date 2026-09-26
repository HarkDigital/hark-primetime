import * as THREE from 'three'
import { PALETTE } from '../kit/field'
import { canvasTexture, drawMark, font, onFonts, trackedText } from '../kit/type'
import { HAZE_GLSL, WORLD_UNIFORMS, WORLD_UNIFORM_DECL } from './shared'

/*
 * The video board over the EAST end zone: 56 × 22 yd of LED, facing the
 * field (-x). Its screen composites two layers:
 *   bg    a full-board texture (the idle Hark graphic by default; chapters
 *         can hand it their own canvas via world.params.boardBg)
 *   main  a picture (e.g. a site screenshot) in a sub-rect of the board
 *         (world.params.boardMain / boardRect / boardMainOn)
 * An LED dot mask shows up close and averages out at a distance, so it
 * never moirés.
 */

export const BOARD = {
  center: new THREE.Vector3(108, 38, 0),
  width: 56,
  height: 22,
}
/** board aspect (w/h) — draw board canvases at this ratio */
export const BOARD_ASPECT = BOARD.width / BOARD.height

const VERT = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform sampler2D tBg, tMain;
uniform vec4 uRect;
uniform float uMainOn, uLevel, uWipe;
varying vec3 vW;
varying vec2 vUv;
${HAZE_GLSL}
void main() {
  vec3 bg = texture2D(tBg, vUv).rgb;
  vec2 m = (vUv - uRect.xy) / uRect.zw;
  float inside = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
  // the picture wipes in left → right (uWipe) like a broadcast graphic
  float shown = inside * uMainOn * step(m.x, uWipe);
  vec3 c = mix(bg, texture2D(tMain, clamp(m, 0.0, 1.0)).rgb, shown);
  // LED dots: 520 × 204 emitters
  vec2 g = vUv * vec2(520.0, 204.0);
  float fp = max(fwidth(g.x), fwidth(g.y));
  float d = length(fract(g) - 0.5);
  float dotm = 1.0 - smoothstep(0.3, 0.5, d);
  float mask = mix(0.55 + dotm * 0.75, 1.0, smoothstep(0.35, 0.9, fp));
  vec3 col = c * mask * uLevel;
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`

/** The idle board: navy field, the mark, HARK.DIGITAL, a live bug. */
export function defaultBoardBg(mobile: boolean) {
  const W = mobile ? 1024 : 2048
  const H = Math.round(W / BOARD_ASPECT)
  const c = canvasTexture(W, H)
  const draw = () => {
    const { ctx } = c
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0f2144')
    g.addColorStop(1, '#060c1c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // diagonal broadcast stripes
    ctx.save()
    ctx.globalAlpha = 0.07
    ctx.fillStyle = '#ffffff'
    for (let x = -H; x < W; x += H * 0.16) {
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.lineTo(x + H * 0.06, H)
      ctx.lineTo(x + H * 0.06 + H * 0.5, 0)
      ctx.lineTo(x + H * 0.5, 0)
      ctx.fill()
    }
    ctx.restore()
    // the mark
    const ms = H * 0.56
    drawMark(ctx, W * 0.5 - ms * 1.55, H * 0.5 - ms / 2, ms, '#ffffff', PALETTE.yellow)
    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'alphabetic'
    ctx.font = font('display', H * 0.3, 800, true)
    trackedText(ctx, 'HARK.DIGITAL', W * 0.5 - ms * 0.55, H * 0.55, 0.01, 'left')
    ctx.fillStyle = PALETTE.yellow
    ctx.font = font('mono', H * 0.065, 600)
    trackedText(ctx, 'LIVE · PHILADELPHIA · EVERYWHERE', W * 0.5 - ms * 0.52, H * 0.7, 0.12, 'left')
    c.tex.needsUpdate = true
  }
  onFonts(draw)
  return c.tex
}

export function buildBoard(mobile: boolean) {
  const group = new THREE.Group()
  group.name = 'board'
  const bgDefault = defaultBoardBg(mobile)
  const uniforms = {
    ...WORLD_UNIFORMS,
    tBg: { value: bgDefault as THREE.Texture },
    tMain: { value: bgDefault as THREE.Texture },
    uRect: { value: new THREE.Vector4(0.06, 0.1, 0.52, 0.8) },
    uMainOn: { value: 0 },
    uLevel: { value: 1 },
    uWipe: { value: 1 },
  }
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.width, BOARD.height),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }),
  )
  screen.rotation.y = -Math.PI / 2
  screen.position.copy(BOARD.center)
  group.add(screen)

  // housing + legs
  const dark = new THREE.MeshBasicMaterial({ color: new THREE.Color('#080c16') })
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, BOARD.height + 2.4, BOARD.width + 2.4), dark)
  frame.position.copy(BOARD.center).add(new THREE.Vector3(1.4, 0, 0))
  group.add(frame)
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, BOARD.center.y, 2), dark)
    leg.position.set(BOARD.center.x + 2, BOARD.center.y / 2 - BOARD.height / 2, s * BOARD.width * 0.32)
    group.add(leg)
  }
  // a thin accent strip under the screen (lit like the ribbon)
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.width, 0.5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.yellow).multiplyScalar(1.4) }),
  )
  strip.rotation.y = -Math.PI / 2
  strip.position.copy(BOARD.center).add(new THREE.Vector3(-0.05, -BOARD.height / 2 - 0.9, 0))
  group.add(strip)

  return { group, screen, uniforms, bgDefault }
}
