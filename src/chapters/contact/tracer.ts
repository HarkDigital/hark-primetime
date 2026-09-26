import * as THREE from 'three'
import { PALETTE } from '../../kit/field'

/*
 * A broadcast ball tracer: a thin glowing tube along the ball's flight, drawn
 * up to the ball (uHead 0..1 along the path) with a tail that fades behind
 * it, then fading out as a whole (uOpacity). The flight is given as points.
 */

const VERT = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vW;
void main() {
  vT = uv.x;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const FRAG = /* glsl */ `
uniform vec3 uColor, uHot;
uniform float uHead, uTail, uOpacity;
varying float vT;
varying vec3 vN;
varying vec3 vW;
void main() {
  if (vT > uHead) discard;
  // tail: fades in over uTail of the path behind the head
  float tail = smoothstep(uHead - uTail, uHead, vT);
  // the tube's core is hotter than its rim
  vec3 v = normalize(cameraPosition - vW);
  float core = abs(dot(normalize(vN), v));
  // the first stretch (over the camera's shoulder) stays faint
  float start = smoothstep(0.2, 0.5, vT);
  float a = (0.3 + 0.7 * tail) * (0.35 + 0.65 * core) * start * uOpacity;
  vec3 col = mix(uColor, uHot, tail * tail * core);
  gl_FragColor = vec4(col * a, 1.0);
}
`

export function createTracer(points: THREE.Vector3[], radius = 0.05) {
  const curve = new THREE.CatmullRomCurve3(points)
  const geo = new THREE.TubeGeometry(curve, 160, radius, 6, false)
  const uniforms = {
    uColor: { value: new THREE.Color(PALETTE.yellow).multiplyScalar(0.9) },
    uHot: { value: new THREE.Color('#fff6d6').multiplyScalar(1.3) },
    uHead: { value: 0 },
    uTail: { value: 0.55 },
    uOpacity: { value: 0 },
  }
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  mesh.renderOrder = 7
  mesh.frustumCulled = false
  mesh.name = 'ball-tracer'
  return {
    mesh,
    set(head: number, opacity: number) {
      uniforms.uHead.value = head
      uniforms.uOpacity.value = opacity
      mesh.visible = opacity > 0.002 && head > 0.002
    },
  }
}
