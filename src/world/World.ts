import * as THREE from 'three'
import type { Frame } from '../core/types'
import { buildTurf } from './turf'
import { buildBowl } from './bowl'
import { buildLights } from './lights'
import { buildBoard } from './board'
import { buildSky } from './sky'
import { buildEnv } from './env'
import { buildFixtures } from './fixtures'
import { WORLD_UNIFORMS } from './shared'

/*
 * The shared world: ONE floodlit stadium that every chapter shoots from its
 * own camera positions (see src/kit/field.ts for the coordinates):
 *
 *   turf    the painted field (lines, numbers, the mark at midfield, end zones)
 *   bowl    two seating tiers, ~45k fans as points, the LED ribbon, suites
 *   lights  six towers: lamps (bloom), anamorphic streaks, beams in the haze
 *   board   the video board over the EAST end zone (chapters put pictures on it)
 *   fixtures the yellow goal posts on both end lines and the eight pylons
 *   sky     night dome with the lights' glow in the haze
 *   env     reflections for lit props; key + hemisphere lights for them too
 *
 * Chapters set world.params every frame they care; the engine resets them to
 * WORLD_DEFAULTS first; values are damped so cuts never pop. Textures, rects
 * and the wave position are applied as-is.
 */

export interface WorldParams {
  /** stadium power 0..1: the six light banks switch on in turn; 1 = all on */
  lights: number
  /** anamorphic lens streaks on the light heads */
  streaks: number
  /** light beams in the haze */
  beams: number
  /** distance haze 0..1 */
  haze: number
  /** stands brightness 0..1 */
  stands: number
  /** crowd visibility 0..1, idle fidget 0..1, phone lights 0..1 */
  crowd: number
  crowdMotion: number
  phones: number
  /** the wave: < 0 off, else 0..1 position around the bowl (ring u) */
  wave: number
  /** multiply on turf, paint and stands (e.g. the red zone) */
  tint: THREE.ColorRepresentation
  /** the midfield mark's paint 0..1 */
  mark: number
  /** video board: background texture (null = the idle Hark graphic), a picture in a rect, level */
  boardBg: THREE.Texture | null
  boardMain: THREE.Texture | null
  /** x, y, w, h in board uv (0..1, y up) */
  boardRect: THREE.Vector4
  boardMainOn: number
  /** 0..1 left→right wipe of the picture */
  boardWipe: number
  boardLevel: number
  /** LED ribbon: texture (null = default), scroll in texture repeats (null = idle drift), level */
  ribbon: THREE.Texture | null
  ribbonScroll: number | null
  /** yards of ribbon one texture repeat covers */
  ribbonRepeat: number
  ribbonLevel: number
  /** lights for lit (MeshStandard/Physical) props: key direction it comes FROM, key, fill, env */
  keyDir: THREE.Vector3
  key: number
  fill: number
  env: number
}

export const WORLD_DEFAULTS = {
  lights: 1,
  streaks: 1,
  beams: 1,
  haze: 1,
  stands: 1,
  crowd: 1,
  crowdMotion: 1,
  phones: 0,
  wave: -1,
  tint: '#ffffff',
  mark: 1,
  boardMainOn: 0,
  boardWipe: 1,
  boardLevel: 1,
  ribbonRepeat: 120,
  ribbonLevel: 1,
  key: 1.5,
  fill: 0.55,
  env: 0.7,
}

const DAMPED = ['lights', 'streaks', 'beams', 'haze', 'stands', 'crowd', 'crowdMotion', 'phones', 'mark', 'boardMainOn', 'boardLevel', 'ribbonLevel', 'key', 'fill', 'env'] as const
type Damped = (typeof DAMPED)[number]

export class World {
  object = new THREE.Group()
  key: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  params: WorldParams = {
    ...WORLD_DEFAULTS,
    boardBg: null,
    boardMain: null,
    boardRect: new THREE.Vector4(0.06, 0.1, 0.52, 0.8),
    ribbon: null,
    ribbonScroll: null,
    keyDir: new THREE.Vector3(0.25, 1, 0.45),
  }
  turf: ReturnType<typeof buildTurf>
  bowl: ReturnType<typeof buildBowl>
  lights: ReturnType<typeof buildLights>
  board: ReturnType<typeof buildBoard>
  sky: ReturnType<typeof buildSky>
  fixtures: ReturnType<typeof buildFixtures>
  private cur: Record<Damped, number> & { tint: THREE.Color }
  private first = true
  private envTex: THREE.Texture | null = null
  private tmpC = new THREE.Color()
  private tmpV = new THREE.Vector3()
  private markMat: THREE.ShaderMaterial
  private defaultRibbon: THREE.Texture

  constructor(
    private scene: THREE.Scene,
    mobile: boolean,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.sky = buildSky()
    this.turf = buildTurf(mobile)
    this.bowl = buildBowl(mobile)
    this.lights = buildLights(mobile)
    this.board = buildBoard(mobile)
    this.fixtures = buildFixtures()
    this.object.add(this.sky.dome, this.turf.group, this.bowl.group, this.lights.group, this.board.group, this.fixtures.group)
    this.markMat = this.turf.mark.material as THREE.ShaderMaterial
    this.defaultRibbon = this.bowl.ribbonUniforms.map.value

    this.key = new THREE.DirectionalLight(0xf2f6ff, WORLD_DEFAULTS.key)
    scene.add(this.key)
    scene.add(this.key.target)
    this.hemi = new THREE.HemisphereLight(0x5a6f9a, 0x1d4a26, WORLD_DEFAULTS.fill)
    scene.add(this.hemi)
    this.cur = { ...(Object.fromEntries(DAMPED.map(k => [k, WORLD_DEFAULTS[k]])) as Record<Damped, number>), tint: new THREE.Color(1, 1, 1) }
  }

  /** Reflections for lit props — built once (the engine calls this before prewarm). */
  warmEnv() {
    if (this.envTex) return
    this.envTex = buildEnv(this.renderer)
    this.scene.environment = this.envTex
  }

  resetParams() {
    const p = this.params
    Object.assign(p, WORLD_DEFAULTS)
    p.boardBg = null
    p.boardMain = null
    p.boardRect.set(0.06, 0.1, 0.52, 0.8)
    p.ribbon = null
    p.ribbonScroll = null
    p.keyDir.set(0.25, 1, 0.45)
  }

  update(frame: Frame, camera: THREE.Camera) {
    if (!this.envTex) this.warmEnv()
    const p = this.params
    const c = this.cur
    this.tmpC.set(p.tint)
    if (this.first) {
      for (const k of DAMPED) c[k] = p[k] as number
      c.tint.copy(this.tmpC)
      this.first = false
    }
    const k = 1 - Math.exp(-5 * frame.dt)
    for (const key of DAMPED) c[key] += ((p[key] as number) - c[key]) * k
    c.tint.lerp(this.tmpC, k)

    const U = WORLD_UNIFORMS
    U.uTime.value = frame.time
    this.lights.setState(c.lights, c.streaks, c.beams, frame.time)
    // the turf is as bright as the banks that are on
    const on = (this.lights.lamps.material as THREE.ShaderMaterial).uniforms.uOn.value as number[]
    U.uLights.value = on.reduce((a, b) => a + b, 0) / on.length
    U.uTint.value.copy(c.tint)
    U.uHaze.value = c.haze
    U.uStands.value = c.stands

    const cam = camera as THREE.PerspectiveCamera
    const cu = this.bowl.crowdUniforms
    cu.uPx.value = (frame.height * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov || 45) / 2))
    cu.uCrowd.value = c.crowd
    cu.uMotion.value = c.crowdMotion * (frame.reducedMotion ? 0 : 1)
    cu.uPhones.value = c.phones
    cu.uWaveOn.value = p.wave >= 0 ? 1 : 0
    cu.uWave.value = Math.max(0, p.wave)

    this.markMat.uniforms.uOpacity.value = 0.96 * c.mark

    const bu = this.board.uniforms
    bu.tBg.value = p.boardBg ?? this.board.bgDefault
    bu.tMain.value = p.boardMain ?? bu.tBg.value
    bu.uRect.value.copy(p.boardRect)
    bu.uMainOn.value = p.boardMain ? c.boardMainOn : 0
    bu.uWipe.value = p.boardWipe
    bu.uLevel.value = c.boardLevel * (0.25 + 0.75 * Math.min(1, U.uLights.value * 1.5 + 0.2))

    const ru = this.bowl.ribbonUniforms
    ru.map.value = p.ribbon ?? this.defaultRibbon
    ru.uRepeat.value = p.ribbonRepeat
    ru.uScroll.value = p.ribbonScroll ?? frame.time * 0.012
    ru.uLevel.value = c.ribbonLevel * (0.3 + 0.7 * U.uLights.value)

    const s = this.sky.uniforms
    s.uCam.value.copy(camera.position)
    s.uLights.value = U.uLights.value
    this.sky.dome.position.copy(camera.position)

    this.key.intensity = c.key * (0.15 + 0.85 * U.uLights.value)
    this.key.position.copy(camera.position).addScaledVector(this.tmpV.copy(p.keyDir).normalize(), 50)
    this.key.target.position.copy(camera.position)
    this.key.target.updateMatrixWorld()
    this.hemi.intensity = c.fill * (0.3 + 0.7 * U.uLights.value)
    this.scene.environmentIntensity = c.env * (0.2 + 0.8 * U.uLights.value)
  }
}
