/*
 * Visitor preferences shared by the chrome and the loader, plus the
 * reference-counted "the scene is covered" hold behind engine.paused.
 *
 * Motion: the visitor's Motion switch (engine.motion + html.motion-off). It
 * starts Off under prefers-reduced-motion and remembers the visitor's choice
 * (localStorage, try/catch: blocked storage just means "this visit only").
 *
 * Scene holds: the phone-landscape rotate card and the (opaque) mobile menu
 * both cover the stadium; while either is up the engine skips rendering. Two
 * covers can overlap (a phone turned sideways with the menu open): the scene
 * only runs again once both have let go. Holds taken before bindScene()
 * apply once it runs.
 */

const MOTION_KEY = 'hark-primetime:motion'

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Motion on? The stored choice, else on unless the OS asks for reduced motion. */
export function readMotion(): boolean {
  try {
    const v = localStorage.getItem(MOTION_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* blocked storage: the default for this visit */
  }
  return !prefersReducedMotion()
}

export function rememberMotion(on: boolean) {
  try {
    localStorage.setItem(MOTION_KEY, on ? '1' : '0')
  } catch {
    /* blocked storage: the choice lasts until reload */
  }
}

/** Calm path for UI animation: reduced motion, or the visitor switched Motion off. */
export const calmUi = () => prefersReducedMotion() || document.documentElement.classList.contains('motion-off') || !readMotion()

interface Pausable {
  paused: boolean
}
let target: Pausable | null = null
const holds = new Set<string>()
const apply = () => {
  if (target) target.paused = holds.size > 0
}

export function bindScene(engine: Pausable) {
  target = engine
  apply()
}
export function holdScene(key: string) {
  holds.add(key)
  apply()
}
export function releaseScene(key: string) {
  if (holds.delete(key)) apply()
}
