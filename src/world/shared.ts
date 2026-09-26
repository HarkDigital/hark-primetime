import * as THREE from 'three'

/*
 * Uniforms and GLSL shared by every stadium surface (turf, paint, stands) and
 * by any chapter material that should sit in the same light (kit/ar.ts,
 * paintMaterial). The World writes these once per frame; materials hold the
 * same objects, so there's nothing to sync.
 */
export const WORLD_UNIFORMS = {
  uTime: { value: 0 },
  /** floodlights 0..1 (0 = a dark stadium before the lights come on) */
  uLights: { value: 1 },
  /** multiply on turf + paint + stands (red zone, broadcast "virtual" dims) */
  uTint: { value: new THREE.Color(1, 1, 1) },
  /** distance haze 0..1 and its colour */
  uHaze: { value: 1 },
  uHazeColor: { value: new THREE.Color('#0e1a30') },
  /** stands brightness multiplier 0..1 */
  uStands: { value: 1 },
}

/** Floodlit turf illumination: an even field of light that falls off past the stands. */
export const FLOOD_GLSL = /* glsl */ `
float floodLight(vec3 wp) {
  // six towers light the field almost evenly; a gentle falloff toward the corners
  vec2 q = wp.xz * vec2(1.0 / 78.0, 1.0 / 44.0);
  float r = dot(q, q);
  float pool = 1.0 - 0.28 * smoothstep(0.35, 1.6, r);
  // faint scalloping from the six tower aims
  pool *= 0.96 + 0.04 * cos(wp.x * 0.105) * cos(wp.z * 0.07);
  return uLights * pool + 0.035;
}
`

/** Value noise + grass texture (needs HASH-free: defines its own hash). */
export const GRASS_GLSL = /* glsl */ `
float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = gHash(i), b = gHash(i + vec2(1.0, 0.0)), c = gHash(i + vec2(0.0, 1.0)), d = gHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** 0..1 grass variation; fp = pixel footprint in yards (fades detail that would alias) */
float grass(vec2 xz, float fp) {
  float g = gNoise(xz * 0.35) * 0.45 + gNoise(xz * 1.7 + 7.1) * 0.3;
  float fine = gNoise(xz * 9.0 + 3.3) * 0.25;
  g += fine * (1.0 - smoothstep(0.03, 0.25, fp));
  return g;
}
`

/** Distance haze toward the night sky (needs uHaze, uHazeColor, cameraPosition). */
export const HAZE_GLSL = /* glsl */ `
vec3 applyHaze(vec3 col, vec3 wp) {
  float d = length(wp - cameraPosition);
  float f = (1.0 - exp(-d * 0.0022)) * uHaze;
  return mix(col, uHazeColor, clamp(f, 0.0, 0.85));
}
`

export const WORLD_UNIFORM_DECL = /* glsl */ `
uniform float uTime, uLights, uHaze, uStands;
uniform vec3 uTint, uHazeColor;
`
