import * as THREE from 'three'
import { TOWERS } from './lights'

/*
 * Reflection environment for lit props (the ball, pucks, helmets, the mark):
 * a night dome, a floodlit field below, and six bright light banks. Built
 * once on the GPU with PMREM (a tiny scene, no per-texel JS).
 */
export function buildEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene()
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vD;
        void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vD;
        void main() {
          float y = normalize(vD).y;
          vec3 sky = mix(vec3(0.02, 0.03, 0.06), vec3(0.004, 0.006, 0.014), smoothstep(0.0, 0.7, y));
          // the lit turf and stands below the horizon
          vec3 field = mix(vec3(0.05, 0.16, 0.06), vec3(0.06, 0.07, 0.1), smoothstep(-0.25, -0.02, y));
          vec3 c = y < 0.0 ? field : sky;
          // lit bowl ring around the horizon
          c += vec3(0.1, 0.11, 0.14) * exp(-abs(y - 0.08) * 14.0);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    }),
  )
  scene.add(dome)
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(18), side: THREE.DoubleSide })
  for (const t of TOWERS) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), lampMat)
    // from the field centre, the heads sit up and out
    const dir = t.head.clone().normalize()
    p.position.copy(dir.multiplyScalar(80))
    p.lookAt(0, 0, 0)
    scene.add(p)
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0.02)
  pmrem.dispose()
  dome.geometry.dispose()
  ;(dome.material as THREE.Material).dispose()
  return rt.texture
}
