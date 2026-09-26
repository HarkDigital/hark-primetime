import * as THREE from 'three'
import { FIELD, PALETTE } from '../kit/field'
import { canvasTexture, font, onFonts } from '../kit/type'
import { logoShapes } from '../logo/logo'
import { FLOOD_GLSL, GRASS_GLSL, HAZE_GLSL, WORLD_UNIFORMS, WORLD_UNIFORM_DECL } from './shared'

/*
 * The painted field: one shader draws the grass (mow stripes that flip with
 * the view like real ones), every line analytically (yard lines, goal lines,
 * hashes, the two-point line and the white border, anti-aliased by pixel
 * footprint so they fade instead of shimmer), and the end zone paint. Decals
 * on top use paintMaterial(): the yard numbers, the Hark mark at midfield
 * and the end zone lettering.
 */

const TURF_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const TURF_FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform vec3 uGrassA, uGrassB, uPaint, uEndZone, uApron;
varying vec3 vW;
${GRASS_GLSL}
${FLOOD_GLSL}
${HAZE_GLSL}

// a line of half-width hw at distance d, with fp = pixel footprint (yards)
float lineAA(float d, float hw, float fp) {
  float w = max(hw, fp * 0.5);
  return (1.0 - smoothstep(w - fp * 0.5, w + fp * 0.5, d)) * (hw / w);
}

void main() {
  vec2 p = vW.xz;
  vec2 fw = max(fwidth(p), vec2(1e-4));
  float fp = max(fw.x, fw.y);
  float hl = ${FIELD.halfLength.toFixed(3)};
  float hw = ${FIELD.halfWidth.toFixed(3)};
  float ax = abs(p.x), az = abs(p.y);

  // grass: two greens, mottled; mow stripes every 5 yards that brighten or
  // darken with the view direction (grass leaning toward / away from you)
  float g = grass(p, fp);
  vec3 col = mix(uGrassA, uGrassB, g);
  float stripe = mod(floor((p.x + 60.0) / 5.0), 2.0) * 2.0 - 1.0;
  vec3 view = normalize(cameraPosition - vW);
  float lean = clamp(view.x * 1.6, -1.0, 1.0);
  col *= 1.0 + stripe * (0.05 + 0.085 * lean) * (1.0 - smoothstep(62.0, 66.0, ax));

  bool inField = ax <= hl + ${FIELD.endZone.toFixed(1)} && az <= hw;
  // outside the border: the apron (darker, worn)
  float border = ${FIELD.border.toFixed(1)};
  if (ax > hl + 10.0 + border || az > hw + border) col = mix(col, uApron * (0.8 + 0.4 * g), 0.75);

  // under and beyond the stands: dark concrete
  if (ax > 73.0 || az > 39.0) col = vec3(0.010, 0.012, 0.016) * (0.8 + 0.4 * g);

  // end zones: team paint over the grass
  if (ax > hl && ax < hl + 10.0 && az < hw) {
    float ez = 0.82 + 0.18 * g;
    col = mix(col, uEndZone * ez, 0.9);
  }

  float paint = 0.0;
  // the white border around the whole field of play
  vec2 q = vec2(ax - (hl + 10.0), az - hw);
  float outside = max(q.x, q.y);
  paint = max(paint, lineAA(abs(outside - border * 0.5), border * 0.5, fp));
  // goal lines (8 in) and yard lines every 5 (4 in), 8 in short of the sidelines
  if (az < hw - 0.22) {
    float gl = lineAA(abs(ax - hl), 0.111, fw.x);
    float yl = lineAA(abs(fract((p.x + hl) / 5.0 + 0.5) - 0.5) * 5.0, 0.0556, fw.x) * step(ax, hl - 1.0);
    paint = max(paint, max(gl, yl));
  }
  // hash marks each yard: inbounds pair and the sideline ticks (2 ft long)
  float yd = floor(p.x + 0.5);
  if (abs(yd) < hl && mod(yd + hl, 5.0) != 0.0) {
    float dx = abs(p.x - yd);
    float inb = step(abs(az - ${FIELD.hash.toFixed(3)}), 0.333);
    float side = step(abs(az - (hw - 0.55)), 0.333);
    paint = max(paint, lineAA(dx, 0.0556, fw.x) * max(inb, side));
  }
  // two-point line: 1 yard wide at the 2
  paint = max(paint, lineAA(abs(ax - (hl - 2.0)), 0.0556, fw.x) * step(az, 0.5));

  vec3 chalk = uPaint * (0.86 + 0.14 * g);
  col = mix(col, chalk, clamp(paint, 0.0, 1.0));

  col *= floodLight(vW) * uTint;
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}
`

/** Shared decal shader: paint on the grass (texture alpha or solid geometry). */
const PAINT_VERT = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const PAINT_FRAG = /* glsl */ `
${WORLD_UNIFORM_DECL}
uniform sampler2D map;
uniform float uUseMap, uOpacity;
uniform vec3 uColor;
varying vec3 vW;
varying vec2 vUv;
${GRASS_GLSL}
${FLOOD_GLSL}
${HAZE_GLSL}
void main() {
  vec4 t = uUseMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
  float a = t.a * uOpacity;
  if (a < 0.004) discard;
  vec2 fw = max(fwidth(vW.xz), vec2(1e-4));
  float g = grass(vW.xz, max(fw.x, fw.y));
  // painted grass: the blades show through the paint
  vec3 col = t.rgb * uColor * (0.8 + 0.24 * g);
  col *= floodLight(vW) * uTint;
  col = applyHaze(col, vW);
  gl_FragColor = vec4(col, a * (0.86 + 0.14 * g));
}
`

export interface PaintOptions {
  map?: THREE.Texture | null
  color?: THREE.ColorRepresentation
  opacity?: number
}

/**
 * Paint on the turf: lit and hazed like the field, grass showing through.
 * Lay the mesh flat just above y = 0 (y ≈ 0.01); the material handles the
 * depth offset. `map` alpha is the paint mask (its rgb multiplies `color`).
 */
export function paintMaterial({ map = null, color = PALETTE.chalk, opacity = 1 }: PaintOptions = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...WORLD_UNIFORMS,
      map: { value: map },
      uUseMap: { value: map ? 1 : 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: PAINT_VERT,
    fragmentShader: PAINT_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })
}

/** Orient a plane (XY) flat on the turf, text "up" pointing along `up` (±x or ±z). */
export function layFlat(obj: THREE.Object3D, up: 'x' | '-x' | 'z' | '-z') {
  const Y = new THREE.Vector3(0, 1, 0)
  const u = new THREE.Vector3(up === 'x' ? 1 : up === '-x' ? -1 : 0, 0, up === 'z' ? 1 : up === '-z' ? -1 : 0)
  // right-handed basis: local X (reading right) = up × normal
  const right = new THREE.Vector3().crossVectors(u, Y)
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, u, Y))
}

export function buildTurf(mobile: boolean) {
  const group = new THREE.Group()
  group.name = 'turf'

  const turf = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: {
        ...WORLD_UNIFORMS,
        uGrassA: { value: new THREE.Color('#1c4a22') },
        uGrassB: { value: new THREE.Color('#2f7a37') },
        uPaint: { value: new THREE.Color('#eef0ea') },
        uEndZone: { value: new THREE.Color(PALETTE.navy) },
        uApron: { value: new THREE.Color('#1d3a22') },
      },
      vertexShader: TURF_VERT,
      fragmentShader: TURF_FRAG,
    }),
  )
  turf.renderOrder = -5
  group.add(turf)

  // ---- yard numbers: one atlas (10 20 30 40 50 + arrow), one merged mesh ----
  const cellW = mobile ? 256 : 512
  const cellH = cellW / 2
  const atlas = canvasTexture(cellW * 4, cellH * 2)
  const draw = () => {
    const { ctx, canvas } = atlas
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'center'
    ctx.font = font('display', cellH * 1.12, 700)
    ;['1', '2', '3', '4', '5'].forEach((d, i) => {
      const cx = (i % 4) * cellW
      const cy = Math.floor(i / 4) * cellH
      // the yard line runs between the digits
      ctx.fillText(d, cx + cellW * 0.5 - cellW * 0.19, cy + cellH * 0.94)
      ctx.fillText('0', cx + cellW * 0.5 + cellW * 0.19, cy + cellH * 0.94)
    })
    // arrow (cell 5): a triangle pointing left
    const ax = 1 * cellW
    const ay = cellH
    ctx.beginPath()
    ctx.moveTo(ax + cellW * 0.2, ay + cellH * 0.5)
    ctx.lineTo(ax + cellW * 0.8, ay + cellH * 0.15)
    ctx.lineTo(ax + cellW * 0.8, ay + cellH * 0.85)
    ctx.closePath()
    ctx.fill()
    atlas.tex.needsUpdate = true
  }
  onFonts(draw)

  const quads: THREE.BufferGeometry[] = []
  const cellUv = (i: number) => {
    const cx = i % 4
    const cy = Math.floor(i / 4)
    return [cx / 4, 1 - (cy + 1) / 2, (cx + 1) / 4, 1 - cy / 2] // u0 v0 u1 v1
  }
  const quad = (w: number, h: number, cell: number, x: number, z: number, up: 'z' | '-z', flipU = false) => {
    const g = new THREE.PlaneGeometry(w, h)
    const [u0, v0, u1, v1] = cellUv(cell)
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      const uu = uv.getX(i)
      const vv = uv.getY(i)
      uv.setXY(i, flipU ? u1 - uu * (u1 - u0) : u0 + uu * (u1 - u0), v0 + vv * (v1 - v0))
    }
    const m = new THREE.Object3D()
    layFlat(m, up)
    m.position.set(x, 0.012, z)
    m.updateMatrix()
    g.applyMatrix4(m.matrix)
    quads.push(g)
  }
  const nz = FIELD.halfWidth - 8 // number centres, 8 yd in from each sideline
  for (const side of [1, -1] as const) {
    // numbers read upright from their own sideline: bottom toward the sideline
    const up = side > 0 ? '-z' : 'z'
    for (let yd = 10; yd <= 90; yd += 10) {
      const n = yd <= 50 ? yd : 100 - yd
      const x = yd - 50
      quad(4, 2, n / 10 - 1, x, side * nz, up)
      if (n !== 50) {
        // arrow beside the number, on the goal side, pointing at the nearer goal
        const toWest = yd < 50
        const ox = x + (toWest ? -2.35 : 2.35)
        // the arrow cell points left in texture space; flip for the other way
        const pointsLeftOnScreen = side > 0 ? toWest : !toWest
        quad(0.9, 0.9, 5, ox, side * (nz - 0.55), up, !pointsLeftOnScreen)
      }
    }
  }
  const numbers = new THREE.Mesh(mergeGeoms(quads), paintMaterial({ map: atlas.tex, color: '#eef0ea' }))
  numbers.renderOrder = -4
  group.add(numbers)

  // ---- the Hark mark at midfield, painted white, read from the home sideline ----
  const markGeo = new THREE.ShapeGeometry(logoShapes(), 24)
  const mark = new THREE.Mesh(markGeo, paintMaterial({ color: '#f1f2ec', opacity: 0.96 }))
  layFlat(mark, '-z')
  mark.scale.setScalar(10)
  mark.position.set(0, 0.014, 0)
  mark.renderOrder = -3
  mark.name = 'midfield-mark'
  group.add(mark)

  // ---- end zones: HARK (east, under the board) and DIGITAL (west) ----
  const ezTex = (word: string) => {
    const c = canvasTexture(mobile ? 1024 : 2048, mobile ? 192 : 384)
    const draw = () => {
      const { ctx, canvas } = c
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = font('display', h * 0.92, 800, true)
      ctx.lineJoin = 'round'
      ctx.lineWidth = h * 0.07
      ctx.strokeStyle = PALETTE.yellow
      ctx.strokeText(word, w / 2, h * 0.54)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(word, w / 2, h * 0.54)
      c.tex.needsUpdate = true
    }
    onFonts(draw)
    return c.tex
  }
  const ez = (word: string, east: boolean) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(44, 8.25), paintMaterial({ map: ezTex(word) }))
    layFlat(m, east ? 'x' : '-x')
    m.position.set((east ? 1 : -1) * (FIELD.halfLength + 5), 0.013, 0)
    m.renderOrder = -3
    return m
  }
  group.add(ez('HARK', true), ez('DIGITAL', false))

  return { group, turf, mark, numbers }
}

function mergeGeoms(list: THREE.BufferGeometry[]) {
  const pos: number[] = []
  const uv: number[] = []
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g
    const p = ng.attributes.position
    const t = ng.attributes.uv
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      uv.push(t.getX(i), t.getY(i))
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return out
}
