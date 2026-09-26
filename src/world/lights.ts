import * as THREE from 'three'
import { rng } from '../core/math'

/*
 * Six light towers behind the upper tier, each a mast and a tilted head of
 * lamps aimed at the field. Three layers sell the night-game look:
 *   lamps    HDR discs (bloom catches them)
 *   streaks  a camera-facing anamorphic flare per head, strongest when the
 *            lens looks into the lamps
 *   beams    faint additive cones through the haze, head → field
 *
 * Towers switch on bank by bank: world.params.lights 0..1 lights them in
 * order (0 = all dark, 1 = all on), so the hero can "power up" the stadium.
 */

export interface Tower {
  head: THREE.Vector3
  aim: THREE.Vector3
  /** 0..1, the point in world.params.lights where this bank switches on */
  on: number
}

export const TOWERS: Tower[] = [
  [-60, 1],
  [0, 1],
  [60, 1],
  [60, -1],
  [0, -1],
  [-60, -1],
].map(([x, s], i) => ({
  head: new THREE.Vector3(x, 86, s * 104),
  aim: new THREE.Vector3(x * 0.45, 0, s * 6),
  on: [0.12, 0.28, 0.44, 0.6, 0.76, 0.9][[0, 3, 1, 4, 2, 5].indexOf(i)],
}))

const LAMP_VERT = /* glsl */ `
attribute float aTower;
attribute float aSeed;
uniform float uOn[6];
uniform float uLevel;
varying float vI;
varying vec2 vUv;
void main() {
  vUv = uv;
  int t = int(aTower + 0.5);
  float on = 0.0;
  for (int i = 0; i < 6; i++) if (i == t) on = uOn[i];
  vI = on * uLevel * (0.85 + 0.3 * aSeed);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`
const LAMP_FRAG = /* glsl */ `
varying float vI;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.55, 1.0, r);
  vec3 off = vec3(0.05, 0.055, 0.06);
  vec3 lamp = vec3(0.95, 0.97, 1.0) * (2.2 + 4.5 * (1.0 - r));
  gl_FragColor = vec4(mix(off, lamp, vI) * core + off * (1.0 - core), 1.0);
}
`

const STREAK_VERT = /* glsl */ `
attribute vec3 aHead;
attribute vec3 aAim;
attribute float aTower;
uniform float uOn[6];
uniform float uLevel, uAspect;
varying vec2 vUv;
varying float vI;
void main() {
  vUv = uv;
  int t = int(aTower + 0.5);
  float on = 0.0;
  for (int i = 0; i < 6; i++) if (i == t) on = uOn[i];
  vec3 toCam = normalize(cameraPosition - aHead);
  vec3 aimDir = normalize(aAim - aHead);
  float facing = clamp(dot(toCam, aimDir), 0.0, 1.0);
  vI = on * uLevel * (0.25 + 0.75 * facing * facing);
  vec4 mv = viewMatrix * vec4(aHead, 1.0);
  // constant on-screen size: scale with depth
  float s = -mv.z;
  mv.xy += position.xy * vec2(0.9, 0.022) * s;
  gl_Position = projectionMatrix * mv;
}
`
const STREAK_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vI;
void main() {
  vec2 c = vUv - 0.5;
  float h = exp(-abs(c.x) * 7.0) * exp(-c.y * c.y * 60.0);
  float core = exp(-dot(c * vec2(22.0, 1.0), c * vec2(22.0, 1.0)) * 18.0);
  vec3 col = vec3(0.45, 0.62, 1.0) * h * 0.9 + vec3(1.0, 0.96, 0.9) * core * 1.2;
  gl_FragColor = vec4(col * vI, 1.0);
}
`

const BEAM_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
// Soft volumetric cone: find where the view ray passes closest to the beam
// axis and shade by that distance over the cone's radius there. Drawn from
// the back faces only, so every pixel is shaded once (no silhouette seams).
const BEAM_FRAG = /* glsl */ `
uniform float uI, uTime;
uniform vec3 uHead, uAxis;
uniform float uLen, uR0, uR1;
varying vec3 vW;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vW - ro);
  vec3 w0 = ro - uHead;
  float b = dot(rd, uAxis);
  float d = dot(rd, w0);
  float e = dot(uAxis, w0);
  float den = max(1.0 - b * b, 1e-4);
  float sc = (b * e - d) / den;         // along the ray
  float tc = (e - b * d) / den;         // along the axis
  sc = max(sc, 0.0);
  tc = clamp(tc, 0.0, uLen);
  vec3 pr = ro + rd * sc;
  vec3 pa = uHead + uAxis * tc;
  float t = tc / uLen;
  float r = mix(uR0, uR1, t);
  float dist = length(pr - pa) / r;
  float core = exp(-dist * dist * 2.2);
  float along = (1.0 - t) * (1.0 - t) * 0.85 + 0.15 * (1.0 - t);
  float n = 0.8 + 0.2 * sin(pa.y * 0.09 + uTime * 0.25);
  gl_FragColor = vec4(vec3(0.72, 0.8, 1.0) * core * along * n * uI * 0.16, 1.0);
}
`

export function buildLights(mobile: boolean) {
  const group = new THREE.Group()
  group.name = 'lights'
  const onU = { value: TOWERS.map(() => 1) }
  const levelU = { value: 1 }

  const mastMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#121826') })
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#141a26') })
  const COLS = 8
  const ROWS = 4
  const lamps = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.9, 1.9),
    new THREE.ShaderMaterial({
      uniforms: { uOn: onU, uLevel: levelU },
      vertexShader: LAMP_VERT,
      fragmentShader: LAMP_FRAG,
    }),
    TOWERS.length * COLS * ROWS,
  )
  const aTower = new Float32Array(lamps.count)
  const aSeed = new Float32Array(lamps.count)
  const rand = rng(86)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const tmp = new THREE.Object3D()
  let k = 0
  TOWERS.forEach((t, ti) => {
    // mast: ground to just under the head
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.3, t.head.y, 1.3), mastMat)
    mast.position.set(t.head.x, t.head.y / 2 - 4, t.head.z + Math.sign(t.head.z) * 3)
    group.add(mast)
    // head: a panel facing the aim point
    tmp.position.copy(t.head)
    tmp.lookAt(t.aim)
    tmp.updateMatrix()
    q.copy(tmp.quaternion)
    const head = new THREE.Mesh(new THREE.BoxGeometry(COLS * 2.4 + 1.2, ROWS * 2.4 + 1.2, 0.8), headMat)
    head.position.copy(t.head)
    head.quaternion.copy(q)
    head.translateZ(-0.6)
    group.add(head)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        tmp.position.copy(t.head)
        tmp.quaternion.copy(q)
        tmp.translateX((c - (COLS - 1) / 2) * 2.4)
        tmp.translateY((r - (ROWS - 1) / 2) * 2.4)
        tmp.updateMatrix()
        lamps.setMatrixAt(k, tmp.matrix)
        aTower[k] = ti
        aSeed[k] = rand()
        k++
      }
  })
  void m
  lamps.geometry.setAttribute('aTower', new THREE.InstancedBufferAttribute(aTower, 1))
  lamps.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1))
  lamps.frustumCulled = false
  group.add(lamps)

  // anamorphic streaks: one camera-facing quad per head
  const sg = new THREE.InstancedBufferGeometry()
  const base = new THREE.PlaneGeometry(1, 1)
  sg.index = base.index
  sg.setAttribute('position', base.attributes.position)
  sg.setAttribute('uv', base.attributes.uv)
  sg.instanceCount = TOWERS.length
  sg.setAttribute('aHead', new THREE.InstancedBufferAttribute(new Float32Array(TOWERS.flatMap(t => t.head.toArray())), 3))
  sg.setAttribute('aAim', new THREE.InstancedBufferAttribute(new Float32Array(TOWERS.flatMap(t => t.aim.toArray())), 3))
  sg.setAttribute('aTower', new THREE.InstancedBufferAttribute(new Float32Array(TOWERS.map((_, i) => i)), 1))
  const streakLevel = { value: 1 }
  const streaks = new THREE.Mesh(
    sg,
    new THREE.ShaderMaterial({
      uniforms: { uOn: onU, uLevel: streakLevel, uAspect: { value: 1 } },
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  streaks.frustumCulled = false
  streaks.renderOrder = 20
  group.add(streaks)

  // beams through the haze (desktop only)
  const beamTime = { value: 0 }
  const beams: THREE.Mesh[] = []
  if (!mobile) {
    TOWERS.forEach(t => {
      const len = t.head.distanceTo(t.aim)
      const axis = t.aim.clone().sub(t.head).normalize()
      const R0 = 7
      const R1 = 36
      // a slightly oversized cone is only the bounding volume; the shader does the shape
      const g = new THREE.CylinderGeometry(R0 * 1.8, R1 * 1.8, len, 20, 1, true)
      g.translate(0, -len / 2, 0)
      const beam = new THREE.Mesh(
        g,
        new THREE.ShaderMaterial({
          uniforms: {
            uI: { value: 1 },
            uTime: beamTime,
            uHead: { value: t.head.clone() },
            uAxis: { value: axis },
            uLen: { value: len },
            uR0: { value: R0 },
            uR1: { value: R1 },
          },
          vertexShader: BEAM_VERT,
          fragmentShader: BEAM_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
        }),
      )
      beam.position.copy(t.head)
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis)
      beam.renderOrder = 19
      beam.frustumCulled = false
      beams.push(beam)
      group.add(beam)
    })
  }

  return {
    group,
    lamps,
    streaks,
    beams,
    setState(lights: number, streak: number, beam: number, time: number) {
      TOWERS.forEach((t, i) => {
        // each bank snaps on over a short ramp (a warm-up flicker is a flash; keep it clean)
        onU.value[i] = Math.min(1, Math.max(0, (lights - t.on) / 0.06))
      })
      streakLevel.value = streak
      beamTime.value = time
      beams.forEach((b, i) => ((b.material as THREE.ShaderMaterial).uniforms.uI.value = beam * onU.value[i]))
    },
  }
}
