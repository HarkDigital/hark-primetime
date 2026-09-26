import * as THREE from 'three'

/*
 * An unlit rim-light shell for the hero ball: the floodlights on both
 * sidelines catch the leather's edges (a fresnel term weighted toward the
 * two tower directions), added over the lit ball. No extra scene lights, so
 * no program recompiles; cheap on every device.
 */
const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uDirA, uDirB;
uniform float uI;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float f = 1.0 - clamp(dot(n, v), 0.0, 1.0);
  float rim = f * f * f;
  float s = max(clamp(dot(n, uDirA), 0.0, 1.0), clamp(dot(n, uDirB), 0.0, 1.0));
  gl_FragColor = vec4(uColor * rim * (0.15 + 0.85 * s * s) * uI, 1.0);
}
`

export function rimShell(geometry: THREE.BufferGeometry) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0.78, 0.86, 1.0) },
      // toward the home (+z) and away (−z) tower banks, a little downfield
      uDirA: { value: new THREE.Vector3(0.35, 0.55, 0.76).normalize() },
      uDirB: { value: new THREE.Vector3(0.35, 0.55, -0.76).normalize() },
      uI: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.setScalar(1.006)
  mesh.renderOrder = 8
  return { mesh, material }
}
