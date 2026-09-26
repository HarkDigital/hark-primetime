import * as THREE from 'three'

/*
 * The field, in world units. 1 unit = 1 yard.
 *
 *   x  runs the length of the field: goal lines at x = ±50, end lines at ±60
 *      (the WEST end zone is x < -50, the EAST end zone, under the video
 *      board, is x > 50). Midfield (the 50) is x = 0.
 *   z  runs across it: sidelines at z = ±FIELD.halfWidth (±26.67). The
 *      home sideline (the broadcast side, where the main camera sits) is +z.
 *   y  is up. The turf is the plane y = 0.
 *
 * Yard lines are named the broadcast way, from the WEST goal line: yardX(0)
 * is the west goal line, yardX(50) midfield, yardX(100) the east goal line.
 */
export const FIELD = {
  /** half the length between the goal lines */
  halfLength: 50,
  /** end zone depth */
  endZone: 10,
  /** half the width, sideline to sideline (160 ft) */
  halfWidth: 160 / 6,
  /** inbounds hash marks (NFL, 18'6" apart) */
  hash: 18.5 / 6,
  /** the white border outside the sidelines / end lines */
  border: 2,
  /** the wall at the foot of the lower bowl (rounded-rect half extents) */
  wallX: 72,
  wallZ: 38,
  wallR: 16,
} as const

/** x of a yard line counted from the west goal line (0..100). */
export const yardX = (yd: number) => yd - 50

/** A point on the turf (y = 0) at yard line `yd` (from the west goal) and z. */
export const turfPoint = (yd: number, z = 0, out = new THREE.Vector3()) => out.set(yardX(yd), 0, z)

/**
 * Broadcast palette (sRGB hex). The accent is the first-down line yellow;
 * red is kept for the red zone / the hack. Turf green is the world's, never
 * an accent.
 */
export const PALETTE = {
  night: '#060a14',
  navy: '#0d1b35',
  navyDeep: '#08122a',
  chalk: '#f3f4ee',
  yellow: '#ffd23f',
  yellowDeep: '#c99a00',
  red: '#ff4b3a',
  turf: '#2a6a33',
  sky: '#0a1224',
} as const
