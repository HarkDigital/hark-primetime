import * as THREE from 'three'
import { rng } from '../../core/math'
import { PALETTE } from '../../kit/field'
import { HAZE_GLSL, WORLD_UNIFORMS, WORLD_UNIFORM_DECL } from '../../world/shared'

/*
 * Touchdown confetti: paper squares drifting down through the floodlights in
 * first-down yellow, chalk and navy. One instanced draw; every piece is placed
 * in the vertex shader from its seed and two clocks the chapter sets each
 * frame (no per-frame CPU work, nothing accumulates):
 *
 *   uFall    how far the paper has fallen (yards) — from local + idle time
 *   uTumble  the slow tumble angle clock (seconds-ish)
 *   uShow    0..1 share of pieces in the air (pieces pop in by seed)
 *   uDrop    extra height (yards) — the whole sheet descends from above
 *
 * Shading is gentle (0.62..1.0) so a tumbling piece glints slowly, never
 * sparkles.
 */

const VERT = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform float uFall, uTumble, uShow, uDrop, uSize;
uniform vec3 uMin, uSize3;
attribute vec4 aSeed;   // x, z (0..1), height phase, rank
attribute vec4 aSpin;   // tumble axis (xyz), rate
attribute vec3 aColor;
varying vec3 vColor;
varying vec3 vW;
varying float vShade;

mat3 rotAxis(vec3 a, float t) {
  float s = sin(t), c = cos(t), o = 1.0 - c;
  return mat3(
    o * a.x * a.x + c,       o * a.x * a.y + a.z * s, o * a.z * a.x - a.y * s,
    o * a.x * a.y - a.z * s, o * a.y * a.y + c,       o * a.y * a.z + a.x * s,
    o * a.z * a.x + a.y * s, o * a.y * a.z - a.x * s, o * a.z * a.z + c
  );
}

void main() {
  float r = aSeed.w;
  // pieces enter by rank; each grows in over a short span (no pop)
  float on = clamp((uShow - r) * 12.0, 0.0, 1.0);
  float size = uSize * mix(0.7, 1.25, fract(r * 7.13)) * on;
  float H = uSize3.y;
  float speed = mix(0.75, 1.3, fract(r * 3.71));
  float fall = uFall * speed;
  float y = uMin.y + H - mod(aSeed.z * H + fall, H) + uDrop * mix(0.75, 1.25, fract(r * 5.17));
  // flutter: a slow side-to-side sway as the paper falls
  float ph = r * 40.0;
  float sway = sin(fall * 0.55 + ph);
  vec3 base = vec3(
    uMin.x + aSeed.x * uSize3.x + sway * 0.9,
    y,
    uMin.z + aSeed.y * uSize3.z + cos(fall * 0.4 + ph * 1.3) * 0.9
  );
  // pieces that drift right up to the lens shrink away (no giant squares)
  size *= smoothstep(2.5, 9.0, distance(base, cameraPosition));
  mat3 R = rotAxis(normalize(aSpin.xyz), uTumble * aSpin.w + ph);
  vec3 p = R * vec3(position.xy * vec2(size, size * 0.72), 0.0);
  vec3 n = R * vec3(0.0, 0.0, 1.0);
  vec4 w = modelMatrix * vec4(base + p, 1.0);
  vW = w.xyz;
  // floodlight from high overhead: faces turned to it are brighter, gently
  float facing = abs(dot(n, normalize(vec3(0.15, 1.0, 0.25))));
  vShade = 0.62 + 0.38 * facing;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
varying vec3 vColor;
varying vec3 vW;
varying float vShade;
${HAZE_GLSL}
void main() {
  vec3 col = vColor * vShade * (0.2 + 0.8 * uLights);
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`

export interface ConfettiOptions {
  count: number
  /** the volume the paper falls through: min corner and size (yards) */
  min: THREE.Vector3
  size: THREE.Vector3
  /** piece edge (yards) */
  piece?: number
}

export function createConfetti({ count, min, size, piece = 0.42 }: ConfettiOptions) {
  const plane = new THREE.PlaneGeometry(1, 1)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = plane.index
  geo.setAttribute('position', plane.getAttribute('position'))
  geo.instanceCount = count
  const rand = rng(1107)
  const seed = new Float32Array(count * 4)
  const spin = new Float32Array(count * 4)
  const color = new Float32Array(count * 3)
  // paper colours (linear), capped under the bloom threshold
  const palette = [
    [new THREE.Color(PALETTE.yellow).multiplyScalar(0.92), 0.46],
    [new THREE.Color(PALETTE.chalk).multiplyScalar(0.82), 0.36],
    [new THREE.Color('#1c3a78'), 0.18],
  ] as const
  for (let i = 0; i < count; i++) {
    seed.set([rand(), rand(), rand(), i / count], i * 4)
    const ax = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
    // slow tumble: 0.35..1.0 rad per clock second, either way
    spin.set([ax.x, ax.y, ax.z, (0.35 + rand() * 0.65) * (rand() < 0.5 ? -1 : 1)], i * 4)
    let pick = rand()
    let c = palette[0][0]
    for (const [col, share] of palette) {
      c = col
      pick -= share
      if (pick <= 0) break
    }
    color.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4))
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3))
  const uniforms = {
    ...WORLD_UNIFORMS,
    uFall: { value: 0 },
    uTumble: { value: 0 },
    uShow: { value: 0 },
    uDrop: { value: 0 },
    uSize: { value: piece },
    uMin: { value: min.clone() },
    uSize3: { value: size.clone() },
  }
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide }),
  )
  mesh.frustumCulled = false
  mesh.name = 'confetti'
  return {
    mesh,
    uniforms,
    set(fall: number, tumble: number, show: number, drop: number) {
      uniforms.uFall.value = fall
      uniforms.uTumble.value = tumble
      uniforms.uShow.value = show
      uniforms.uDrop.value = drop
      mesh.visible = show > 0.001
    },
  }
}
