import * as THREE from 'three'
import type { CameraPose, Frame } from '../core/types'
import { clamp } from '../core/math'

/*
 * Broadcast camera positions, as pose helpers. All pure functions of their
 * inputs (derive the inputs from `local`).
 *
 *   setPose(out, pos, target, fov)          write a pose
 *   orbit(out, target, dist, az, el, fov)   az 0 = looking from the home
 *                                           sideline (+z) toward -z; +az swings
 *                                           toward the east end; el up from level
 *   blendPose(out, a, b, t)                 lerp two poses (positions, targets, fov)
 *   isPortrait(frame)
 *
 * Framing rule of the site: on landscape the chapter copy sits LEFT, so aim
 * the subject right of centre; on portrait the copy sits top and bottom, so
 * keep the subject in the middle band and a little smaller.
 */

export interface PoseLike {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

export function setPose(out: CameraPose, pos: THREE.Vector3Like, target: THREE.Vector3Like, fov = 40) {
  out.position.set(pos.x, pos.y, pos.z)
  out.target.set(target.x, target.y, target.z)
  out.fov = fov
  return out
}

export function orbit(out: CameraPose | PoseLike, target: THREE.Vector3Like, dist: number, az: number, el: number, fov = 40) {
  const ce = Math.cos(el)
  out.position.set(target.x + Math.sin(az) * ce * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * ce * dist)
  out.target.set(target.x, target.y, target.z)
  out.fov = fov
  return out
}

export function blendPose(out: CameraPose | PoseLike, a: PoseLike, b: PoseLike, t: number) {
  const k = clamp(t)
  out.position.lerpVectors(a.position, b.position, k)
  out.target.lerpVectors(a.target, b.target, k)
  out.fov = a.fov + (b.fov - a.fov) * k
  return out
}

export function makePose(fov = 40): PoseLike {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), fov }
}

export const isPortrait = (frame: Frame) => frame.height > frame.width * 1.05

/**
 * Shift a pose sideways (in its own screen space) so the subject at `target`
 * lands `amount` of the half-width right of centre on landscape screens.
 * Portrait: no shift, but pulls back by `portraitBack` (e.g. 1.3).
 */
export function frameRight(out: CameraPose, frame: Frame, amount = 0.28, portraitBack = 1.3) {
  const dir = new THREE.Vector3().subVectors(out.target, out.position)
  const dist = dir.length()
  if (isPortrait(frame)) {
    out.position.copy(out.target).addScaledVector(dir.normalize(), -dist * portraitBack)
    return out
  }
  const right = new THREE.Vector3().crossVectors(dir.normalize(), new THREE.Vector3(0, 1, 0)).normalize()
  const halfW = Math.tan(THREE.MathUtils.degToRad(out.fov) / 2) * dist * (frame.width / frame.height)
  // moving camera AND target left puts the subject right of centre
  const shift = -amount * halfW
  out.position.addScaledVector(right, shift)
  out.target.addScaledVector(right, shift)
  return out
}
