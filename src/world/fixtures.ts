import * as THREE from 'three'
import { FIELD } from '../kit/field'

/*
 * Field fixtures that belong to the stadium, not a chapter: the two yellow
 * goal posts on the end lines (gooseneck, crossbar at 10 ft, uprights 18'6"
 * apart rising 35 ft, a wind ribbon on top) and the eight orange pylons.
 * Lit materials (they catch the key light and the env reflections).
 */
export function buildFixtures() {
  const group = new THREE.Group()
  group.name = 'fixtures'
  const yellow = new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.35, metalness: 0.15, emissive: new THREE.Color('#3a2a00') })
  const pad = new THREE.MeshStandardMaterial({ color: '#13254a', roughness: 0.8 })
  const ribbon = new THREE.MeshStandardMaterial({ color: '#ff5a2a', roughness: 0.7, side: THREE.DoubleSide, emissive: new THREE.Color('#401000') })
  const orange = new THREE.MeshStandardMaterial({ color: '#ff6a1f', roughness: 0.6, emissive: new THREE.Color('#5a1a00') })

  const barY = 10 / 3
  const half = 18.5 / 6 / 2
  const topY = barY + 35 / 3
  const R = 0.075
  for (const s of [-1, 1]) {
    const endX = s * (FIELD.halfLength + FIELD.endZone)
    const post = new THREE.Group()
    // gooseneck: from the base behind the end line, up and over to the crossbar
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(endX + s * 2, 0, 0),
      new THREE.Vector3(endX + s * 2, barY * 0.6, 0),
      new THREE.Vector3(endX + s * 1.6, barY * 0.93, 0),
      new THREE.Vector3(endX + s * 0.4, barY, 0),
      new THREE.Vector3(endX, barY, 0),
    ])
    post.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, R * 1.6, 10), yellow))
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.3, R * 1.3, half * 2, 10), yellow)
    bar.rotation.x = Math.PI / 2
    bar.position.set(endX, barY, 0)
    post.add(bar)
    for (const z of [-half, half]) {
      const up = new THREE.Mesh(new THREE.CylinderGeometry(R, R, topY - barY, 10), yellow)
      up.position.set(endX, (barY + topY) / 2, z)
      post.add(up)
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.3), ribbon)
      flag.position.set(endX, topY - 0.7, z)
      flag.rotation.y = s * 0.4
      post.add(flag)
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.2, 16), pad)
    base.position.set(endX + s * 2, 1.1, 0)
    post.add(base)
    group.add(post)
  }

  // pylons: goal line and end line corners (4" square, 18" tall)
  const pylonGeo = new THREE.BoxGeometry(0.11, 0.5, 0.11)
  for (const x of [-FIELD.halfLength, FIELD.halfLength, -FIELD.halfLength - FIELD.endZone, FIELD.halfLength + FIELD.endZone])
    for (const z of [-FIELD.halfWidth - 0.06, FIELD.halfWidth + 0.06]) {
      const p = new THREE.Mesh(pylonGeo, orange)
      p.position.set(x, 0.25, z)
      group.add(p)
    }
  return { group }
}
