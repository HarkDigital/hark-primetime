import * as THREE from 'three'
import type { PoseLike } from '../../kit/cams'
import { lerp } from '../../core/math'

/*
 * Broadcast framing for the highlight reel. Every replay angle is described
 * by where the camera sits relative to its subject (azimuth / elevation off
 * the board's normal, a lens) and how big the subject should read on screen;
 * aim() solves the distance and trucks the camera so the subject lands on a
 * given screen point — right of the lower third on landscape, in the middle
 * band on portrait. Pure functions: everything derives from the inputs.
 */

const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _f = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _c = new THREE.Vector3()

export interface Angle {
  /** degrees off the board normal (−x): + toward the home side (+z) */
  az: number
  /** degrees above (+) / below (−) the subject */
  el: number
  /** vertical fov (deg) as it would be on a 16:10 frame; other aspects keep the horizontal angle */
  lens: number
  /** subject width as a fraction of the free screen region (0..1) */
  k: number
  /** dutch roll, radians */
  roll: number
}

export const angle = (az: number, el: number, lens: number, k: number, roll = 0): Angle => ({ az, el, lens, k, roll })

export function mixAngle(a: Angle, b: Angle, t: number, out: Angle): Angle {
  out.az = lerp(a.az, b.az, t)
  out.el = lerp(a.el, b.el, t)
  out.lens = lerp(a.lens, b.lens, t)
  out.k = lerp(a.k, b.k, t)
  out.roll = lerp(a.roll, b.roll, t)
  return out
}

/** Where the subject should land: a screen region in px (the free space beside/above the copy). */
export interface Region {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** vertical fov for this aspect that keeps the lens's 16:10 horizontal angle (clamped) */
export function fovFor(lens: number, aspect: number) {
  const tanH = Math.tan((lens * DEG) / 2) * 1.6
  const v = (2 * Math.atan(tanH / aspect)) / DEG
  return Math.min(78, Math.max(6, v))
}

export interface AimResult {
  /** screen-width fraction the subject was sized to */
  wf: number
  dist: number
}

/**
 * Frame a board-plane subject (centre S, width `width` yd, aspect `ar` w/h) at
 * `ang`, inside `reg` of a W×H screen. Writes position/target/fov into `out`.
 * `yaw` (radians) turns the camera right about its own position (whip-pans).
 *
 * Solved on the rect's projected corners (a few fixed-point steps), so wide
 * lenses at steep angles — where the near edge balloons — still keep the whole
 * picture inside the region.
 */
export function aim(
  out: PoseLike & { roll?: number },
  S: THREE.Vector3,
  width: number,
  ar: number,
  ang: Angle,
  reg: Region,
  W: number,
  H: number,
  yaw = 0,
): AimResult {
  const aspect = W / H
  const fov = fovFor(ang.lens, aspect)
  const tanV = Math.tan((fov * DEG) / 2)
  const tanH = tanV * aspect
  // the region in NDC (y up)
  const rx0 = (2 * reg.x0) / W - 1
  const rx1 = (2 * reg.x1) / W - 1
  const ry0 = 1 - (2 * reg.y1) / H
  const ry1 = 1 - (2 * reg.y0) / H
  const rw = Math.max(0.1, rx1 - rx0)
  const rh = Math.max(0.1, ry1 - ry0)
  const tx = (rx0 + rx1) / 2
  const ty = (ry0 + ry1) / 2
  const az = ang.az * DEG
  const el = ang.el * DEG
  _dir.set(-Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
  _f.copy(_dir).negate()
  _r.crossVectors(_f, UP).normalize()
  _u.crossVectors(_r, _f)
  // first guess: the projected width at the centre's depth
  const wf = (ang.k * Math.min(rw, (rh * ar) / aspect)) / 2
  let dist = (width * Math.cos(az)) / (2 * wf * tanH)
  let nx = tx
  let ny = ty
  const hw = width / 2
  const hh = width / ar / 2
  for (let it = 0; it < 4; it++) {
    // camera for this guess (trucked so S sits at nx, ny)
    _p.copy(S)
      .addScaledVector(_dir, dist)
      .addScaledVector(_r, -nx * tanH * dist)
      .addScaledVector(_u, -ny * tanV * dist)
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let c = 0; c < 4; c++) {
      _c.set(S.x, S.y + (c & 1 ? hh : -hh), S.z + (c & 2 ? hw : -hw)).sub(_p)
      const z = Math.max(0.5, _c.dot(_f))
      const px = _c.dot(_r) / (z * tanH)
      const py = _c.dot(_u) / (z * tanV)
      x0 = Math.min(x0, px)
      x1 = Math.max(x1, px)
      y0 = Math.min(y0, py)
      y1 = Math.max(y1, py)
    }
    const sc = Math.max((x1 - x0) / (ang.k * rw), (y1 - y0) / (ang.k * rh))
    nx += tx - (x0 + x1) / 2
    ny += ty - (y0 + y1) / 2
    dist *= sc
  }
  placeAt(out, S, _dir, dist, fov, nx, ny, aspect, yaw)
  out.roll = ang.roll
  return { wf, dist }
}

/**
 * Put the camera `dist` from S along `dir` (unit, from S toward the camera),
 * trucked so S lands at NDC (nx, ny), then turned right by `yaw`. With
 * `pan`, the camera stays put and turns instead (pan/tilt — keeps a camera
 * that sits on the turf out of it).
 */
export function placeAt(
  out: PoseLike,
  S: THREE.Vector3,
  dir: THREE.Vector3,
  dist: number,
  fov: number,
  nx: number,
  ny: number,
  aspect: number,
  yaw = 0,
  pan = false,
) {
  const tanV = Math.tan((fov * DEG) / 2)
  const tanH = tanV * aspect
  _f.copy(dir).negate().normalize()
  _r.crossVectors(_f, UP).normalize()
  _u.crossVectors(_r, _f)
  _s.set(0, 0, 0)
    .addScaledVector(_r, -nx * tanH * dist)
    .addScaledVector(_u, -ny * tanV * dist)
  out.position.copy(S).addScaledVector(dir, dist)
  if (!pan) out.position.add(_s)
  out.target.copy(S).add(_s)
  if (yaw) {
    // turn about the camera: forward' = f cos + r sin
    _f.subVectors(out.target, out.position).normalize()
    _r.crossVectors(_f, UP).normalize()
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    _f.multiplyScalar(c).addScaledVector(_r, s)
    out.target.copy(out.position).addScaledVector(_f, dist)
  }
  out.fov = fov
}
