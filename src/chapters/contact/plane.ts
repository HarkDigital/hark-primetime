import * as THREE from 'three'
import { FIELD, PALETTE } from '../../kit/field'

/*
 * "The plane": a broadcast AR sheet standing on the goal line (x = +50),
 * keyed over the scene. It rises from the turf (uRise 0..1), carries faint
 * scan lines, and when the ball breaks it a soft ring spreads from the point
 * of contact (uHit 0..1, driven by local — a single gentle swell, no flash).
 */

const VERT = /* glsl */ `
varying vec2 vP;   // z, y in yards
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = vec2(w.z, w.y);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uRise, uOpacity, uHit, uHeight, uNear;
uniform vec2 uContact, uBall;
varying vec2 vP;
varying vec2 vUv;
void main() {
  // derivatives first (before the discard: never in non-uniform flow)
  float fe = max(fwidth(vP.y), 1e-3);
  float top = uRise * uHeight;
  if (vP.y > top) discard;
  // body: a glow strip at the turf, and the sheet lighting up around the
  // ball as it closes in (uNear)
  float h = clamp(vP.y / max(top, 1e-3), 0.0, 1.0);
  float foot = (1.0 - smoothstep(0.0, 0.9, vP.y)) * 0.1;
  vec2 db = vP - uBall;
  float near = exp(-dot(db, db) / 5.0) * uNear;
  // fine scan lines every 0.25 yd (only where the sheet is lit), faded where they'd shimmer
  float scan = 1.0 - smoothstep(0.0, 0.03 + fe, abs(fract(vP.y * 4.0) - 0.5) * 0.25);
  float body = foot + near * (0.1 + 0.22 * scan * (1.0 - smoothstep(0.02, 0.12, fe)));
  // the top edge: a thin line, bright only near the ball
  float edge = (1.0 - smoothstep(0.0, 0.04 + fe, top - vP.y)) * (0.12 + 0.6 * near);
  // soft falloff toward the sidelines
  float side = 1.0 - smoothstep(0.75, 1.0, abs(vUv.x - 0.5) * 2.0);
  // the ripple where the ball breaks it: one thin ring spreading out
  float d = length(vP - uContact);
  float rr = 0.25 + uHit * 2.6;
  float k = (d - rr) / (0.05 + fe + uHit * 0.05);
  float fade = (1.0 - uHit) * (1.0 - uHit);
  float ring = exp(-k * k) * fade * step(0.001, uHit) * 0.9;
  float a = (body + edge + ring) * side * uOpacity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`

export function createPlane() {
  const height = 4.2
  const geo = new THREE.PlaneGeometry(FIELD.halfWidth * 2, height, 1, 1)
  // stand it on the goal line: local x → world z, local y → world y
  geo.rotateY(Math.PI / 2)
  geo.translate(FIELD.halfLength, height / 2, 0)
  const uniforms = {
    uColor: { value: new THREE.Color(PALETTE.yellow).multiplyScalar(1.1) },
    uRise: { value: 0 },
    uOpacity: { value: 0 },
    uHit: { value: 0 },
    uHeight: { value: height },
    uContact: { value: new THREE.Vector2(0, 1.5) },
    uBall: { value: new THREE.Vector2(0, 1.5) },
    uNear: { value: 0 },
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
      side: THREE.DoubleSide,
    }),
  )
  mesh.renderOrder = 6
  mesh.frustumCulled = false
  mesh.name = 'goal-line-plane'
  return {
    mesh,
    /** ball: where the ball is (z, y) and how close to the plane (near 0..1) */
    set(rise: number, opacity: number, hit: number, contactZ: number, contactY: number, ballZ = 0, ballY = 0, near = 0) {
      uniforms.uRise.value = rise
      uniforms.uOpacity.value = opacity
      uniforms.uHit.value = hit
      uniforms.uContact.value.set(contactZ, contactY)
      uniforms.uBall.value.set(ballZ, ballY)
      uniforms.uNear.value = near
      mesh.visible = opacity > 0.002 && rise > 0.002
    },
  }
}
