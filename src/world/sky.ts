import * as THREE from 'three'
import { TOWERS } from './lights'

/*
 * Night sky over the stadium: deep navy to black, a band of haze at the
 * horizon, the glow the floodlights throw into the haze above the bowl, and
 * a few faint stars. Camera-centred (the World moves it with the camera).
 */
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const FRAG = /* glsl */ `
uniform vec3 uTop, uHorizon, uGlow;
uniform vec3 uCam;
uniform float uLights, uStars;
uniform vec3 uHeads[6];
varying vec3 vDir;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 c = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, y));
  // horizon haze band
  c += uHorizon * 0.6 * exp(-abs(y) * 18.0);
  // light pollution: glow toward the stadium's lit air, and a halo around each head
  vec3 toBowl = normalize(vec3(0.0, 45.0, 0.0) - uCam);
  float bowl = pow(max(dot(d, toBowl), 0.0), 6.0);
  c += uGlow * bowl * 0.55 * uLights;
  for (int i = 0; i < 6; i++) {
    vec3 th = normalize(uHeads[i] - uCam);
    float a = max(dot(d, th), 0.0);
    c += uGlow * (pow(a, 90.0) * 0.5 + pow(a, 12.0) * 0.06) * uLights;
  }
  // a few pinprick stars, very faint (the floodlights wash the rest out)
  vec3 g = floor(d * 1400.0);
  float s = step(0.99985, h3(g)) * smoothstep(0.15, 0.6, y) * (1.0 - bowl);
  c += vec3(0.25, 0.28, 0.34) * s * uStars;
  c += (h3(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0; // dither
  gl_FragColor = vec4(c, 1.0);
}
`

export function buildSky() {
  const uniforms = {
    uTop: { value: new THREE.Color('#010206') },
    uHorizon: { value: new THREE.Color('#0b1428') },
    uGlow: { value: new THREE.Color('#3a5580') },
    uCam: { value: new THREE.Vector3() },
    uLights: { value: 1 },
    uStars: { value: 1 },
    uHeads: { value: TOWERS.map(t => t.head.clone()) },
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
    }),
  )
  dome.frustumCulled = false
  dome.renderOrder = -10
  return { dome, uniforms }
}
