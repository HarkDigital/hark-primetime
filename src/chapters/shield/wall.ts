import * as THREE from 'three'
import { FIELD, PALETTE } from '../../kit/field'

/*
 * The goal-line stand as broadcast AR: a translucent curtain of first-down
 * yellow standing on the goal line, sideline to sideline. It rises centre
 * first (rise 0..1), with a hot leading edge, a glow where it meets the turf,
 * light-fence ribs, faint scan lines and (idle only) a slow sheen that runs
 * along it. Additive, no depth write, visible from both sides.
 */

const VERT = /* glsl */ `
varying vec3 vW;
varying float vY;
void main() {
  vY = uv.y;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uRise, uOpacity, uTime, uSheen, uHeight, uHalf;
varying vec3 vW;
varying float vY;
void main() {
  float z = vW.z;
  // footprints first (uniform control flow)
  float fz = max(fwidth(z), 1e-4);
  float fy = max(fwidth(vY), 1e-4);
  float az = abs(z) / uHalf;
  // the centre rises first, the ends follow (a shallow chevron)
  float h = clamp(uRise * 1.45 - az * 0.45, 0.0, 1.0);
  float y = vY;
  float inside = 1.0 - smoothstep(h - fy, h + fy, y);
  float up = 1.0 - y;
  float body = 0.045 + 0.24 * up * up;
  // light-fence ribs every 1.5 yd (fade out before they could alias)
  float d = abs(fract(z / 1.5 + 0.5) - 0.5) * 1.5;
  float rib = (1.0 - smoothstep(0.025, 0.025 + fz * 1.5, d)) * (1.0 - smoothstep(0.08, 0.35, fz));
  // faint scan lines
  float scan = (0.5 + 0.5 * cos(y * uHeight * 6.2832 * 2.5)) * (1.0 - smoothstep(0.01, 0.05, fy * uHeight));
  // hot leading edge and the seam at the turf
  float edge = (1.0 - smoothstep(0.0, 0.035 + fy * 1.5, h - y)) * step(0.001, h);
  float base = 1.0 - smoothstep(0.0, 0.07, y);
  // an idle sheen running along the wall
  float sp = mod(uTime * 7.0, 90.0) - 45.0;
  float sd = (z - sp) / 3.0;
  float sheen = exp(-sd * sd) * uSheen;
  float ends = 1.0 - smoothstep(0.9, 1.0, az);
  float a = (body * (1.0 + 0.8 * sheen) + rib * 0.2 * (0.35 + up) + scan * 0.035 + edge * 1.25 + base * 0.45) * inside * ends * uOpacity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`

export class ShieldWall {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  constructor({ height = 3.6, x = FIELD.halfLength + 0.3 } = {}) {
    const span = FIELD.halfWidth * 2
    const geo = new THREE.PlaneGeometry(span, height, 1, 1)
    geo.translate(0, height / 2, 0)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(PALETTE.yellow) },
        uRise: { value: 0 },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uSheen: { value: 0 },
        uHeight: { value: height },
        uHalf: { value: FIELD.halfWidth },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.rotation.y = Math.PI / 2
    this.mesh.position.x = x
    this.mesh.renderOrder = 8
    this.mesh.frustumCulled = false
  }
  set(rise: number, opacity: number, time: number, sheen: number) {
    const u = this.material.uniforms
    u.uRise.value = rise
    u.uOpacity.value = opacity
    u.uTime.value = time
    u.uSheen.value = sheen
    this.mesh.visible = rise > 0.001 && opacity > 0.002
  }
}
