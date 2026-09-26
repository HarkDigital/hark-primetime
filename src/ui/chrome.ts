import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND, CONTACT, MICROCOPY } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'
import { bindScene, holdScene, prefersReducedMotion, readMotion, releaseScene, rememberMotion } from './prefs'

/*
 * Persistent chrome: the network's broadcast graphics package. Every piece
 * sits on its own opaque navy plate (no backdrop-filter), so the lettering
 * holds its contrast over the floodlit sky, the white-hot light towers and
 * the painted turf alike. The chrome lives in the top band (--safe-top) and
 * the bottom band (--safe-bottom) only.
 *
 *   top-left      the NETWORK BUG: the Hark mark (ink on a first-down-yellow
 *                 tile) + the "Hark.Digital" wordmark + "Concept · Primetime"
 *                 on a slanted navy plate (→ the start)
 *   top-right     Work · Services · Contact (condensed italic caps; the
 *                 chapter on air carries a yellow bar) + the slanted yellow
 *                 "Start a project". ≤ 820px: a "Menu" plate opens a
 *                 full-screen RUNDOWN (a real modal dialog: focus moves in,
 *                 Tab is trapped, Escape closes, the page behind is inert and
 *                 the scene pauses; focus returns to Menu).
 *   bottom-left   Preferences: Crowd (MICROCOPY.audio) and Motion, both
 *                 aria-pressed with an OFF/ON chip. Motion off sets
 *                 engine.motion = false + html.motion-off, is remembered
 *                 (localStorage) and starts off under prefers-reduced-motion.
 *   bottom-right  the SCORE BUG: [mark] | 01 / 07 | KICKOFF over a row of
 *                 seven "timeout" pips, beside the business name ("HOME") on
 *                 a full-height yellow flag (one ≥ 24px pip per chapter,
 *                 named by its business name) and a thin yellow bar for the
 *                 whole story (frame.progress). Hovering / focusing a pip
 *                 cues that chapter in the bug; the cells keep one width, so
 *                 nothing slides under the pointer. (No game clock here:
 *                 the chapters' own boards run theirs.)
 *
 * API used by main.ts: createChrome(root, engine, sound) → { update(frame, state) }.
 * Navigation always uses engine.land(id) (lands on settled copy; long jumps cut).
 */

/** Plain business names beside each chapter's broadcast label. */
const BUSINESS: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}
const NAV = ['work', 'services', 'contact']
const MENU_QUERY = '(max-width: 820px)'
const MOTION_LABEL = 'Motion'
const pad = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* glyphs (decorative, stroked in currentColor) */
const MENU_IC = `<svg class="ch-ic" viewBox="0 0 20 14" aria-hidden="true" focusable="false"><path d="M3 2h16M2 7h14M1 12h11"/></svg>`
const CLOSE_IC = `<svg class="ch-ic" viewBox="0 0 20 14" aria-hidden="true" focusable="false"><path d="M5 1l10 12M15 1L5 13"/></svg>`
/** the crowd: a PA horn with sound waves (on) or a cross (off) */
const CROWD_IC = `<svg class="ch-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path class="g-body" d="M2.5 7.6h3.2l4.8-3.8v12.4l-4.8-3.8H2.5z"/><path class="g-on" d="M13.4 7.2a4 4 0 0 1 0 5.6M15.9 4.8a7.4 7.4 0 0 1 0 10.4"/><path class="g-off" d="M13.2 7.6l4.8 4.8M18 7.6l-4.8 4.8"/></svg>`
/** motion: the stinger's speed stripes lean while running, stand still when off */
const MOTION_IC = `<svg class="ch-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path class="g-on" d="M3.5 4l3.4 12M8.8 4l3.4 12M14.1 4l3.4 12"/><path class="g-off" d="M5 4v12M10 4v12M15 4v12"/></svg>`

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const slots = engine.slots
  const total = slots.length
  const indexOf = (id: string) => slots.findIndex(s => s.def.id === id)
  const biz = (id: string, fallback = '') => BUSINESS[id] ?? fallback
  const reduced = prefersReducedMotion()
  const first = slots[0]?.def.id ?? 'hero'

  // the rotate card covers the scene: pause it (engine.paused) while it's up.
  // Held through a counter so the opaque menu can pause it too.
  bindScene(engine)
  mountRotateGate(shown => (shown ? holdScene('rotate') : releaseScene('rotate')))

  // ---------------------------------------------------------------- markup

  const bugInner = `<span class="ch-bug-tile" aria-hidden="true">${markSvg('ch-bug-svg')}</span>
      <span class="ch-bug-text" aria-hidden="true">${WORDMARK}${CONCEPT_TAG}</span>`

  const links = NAV.filter(id => indexOf(id) >= 0)
    .map(id => `<li><a class="ch-link" href="#${id}" data-go="${id}">${biz(id)}</a></li>`)
    .join('')

  const pips = slots
    .map(
      (s, i) =>
        `<li><button class="ch-pip" type="button" data-go="${s.def.id}" aria-label="${esc(biz(s.def.id, s.def.label))}: chapter ${i + 1} of ${total}, ${esc(s.def.label)}"><i aria-hidden="true"></i></button></li>`,
    )
    .join('')

  const rundown = slots
    .map(
      (s, i) =>
        `<li style="--i:${i}"><a class="ch-ml" href="#${s.def.id}" data-go="${s.def.id}" aria-label="${esc(biz(s.def.id, s.def.label))}, chapter ${i + 1} of ${total}: ${esc(s.def.label)}">
          <span class="ch-ml-n" aria-hidden="true">${pad(i + 1)}</span>
          <span class="ch-ml-name" aria-hidden="true">${esc(biz(s.def.id, s.def.label))}</span>
          <span class="ch-ml-lab" aria-hidden="true">${esc(s.def.label)}</span>
        </a></li>`,
    )
    .join('')

  let motionOn = readMotion()
  const tgl = (kind: 'sound' | 'motion', extra = '') =>
    kind === 'sound'
      ? `<button class="ch-tgl${extra}" type="button" data-sound-toggle aria-pressed="false">${CROWD_IC}<span class="ch-tgl-k">${MICROCOPY.audio}</span><span class="ch-tgl-st" aria-hidden="true">${MICROCOPY.audioOff}</span></button>`
      : `<button class="ch-tgl${extra}" type="button" data-motion-toggle aria-pressed="${motionOn}">${MOTION_IC}<span class="ch-tgl-k">${MOTION_LABEL}</span><span class="ch-tgl-st" aria-hidden="true">${motionOn ? MICROCOPY.audioOn : MICROCOPY.audioOff}</span></button>`

  root.innerHTML = `
  <div class="ch">
    <header class="ch-top">
      <a class="ch-bug" href="#${first}" data-go="${first}" aria-label="${esc(BRAND.name)}, back to the start">${bugInner}</a>
      <nav class="ch-nav" aria-label="Primary">
        <ul class="ch-links">${links}</ul>
        <a class="hud-btn ch-cta" href="#contact" data-go="contact" data-focus>Start a project</a>
      </nav>
      <button class="ch-menu-btn" type="button" aria-expanded="false" aria-controls="ch-menu" aria-haspopup="dialog"><span>Menu</span>${MENU_IC}</button>
    </header>

    <div class="ch-bottom">
      <div class="ch-prefs" role="group" aria-label="Preferences">${tgl('sound')}${tgl('motion')}</div>
      <div class="ch-score">
        <span class="ch-sc-mark" aria-hidden="true">${markSvg('ch-sc-svg')}</span>
        <span class="ch-sc-n" aria-hidden="true"><b></b><i>/</i><span>${pad(total)}</span></span>
        <span class="ch-sc-l" aria-hidden="true"></span>
        <span class="ch-sc-b" aria-hidden="true"></span>
        <nav class="ch-pips" aria-label="Chapters"><ol>${pips}</ol></nav>
        <span class="ch-sc-bar" aria-hidden="true"><i></i></span>
        <span class="ch-sc-probe" aria-hidden="true"><span class="ch-sc-l"></span><span class="ch-sc-b"></span></span>
      </div>
    </div>

    <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-label="Menu" data-lenis-prevent hidden>
      <div class="ch-menu-band" aria-hidden="true"></div>
      <div class="ch-menu-top">
        <span class="ch-bug ch-menu-bug" aria-hidden="true">${bugInner}</span>
        <button class="ch-menu-btn ch-menu-close" type="button"><span>Close</span>${CLOSE_IC}</button>
      </div>
      <div class="ch-menu-body">
        <p class="ch-menu-k" aria-hidden="true">Tonight’s rundown</p>
        <nav class="ch-menu-nav" aria-label="Chapters"><ol class="ch-ml-list">${rundown}</ol></nav>
        <div class="ch-menu-foot">
          <a class="hud-btn ch-menu-cta" href="#contact" data-go="contact">Start a project</a>
          <a class="ch-menu-mail" href="${CONTACT.href}">${esc(BRAND.email)}</a>
        </div>
        <div class="ch-menu-prefs" role="group" aria-label="Preferences">${tgl('sound', ' ch-menu-tgl')}${tgl('motion', ' ch-menu-tgl')}</div>
      </div>
    </div>
  </div>`

  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!
  const ch = $('.ch')
  const top = $('.ch-top')
  const bottom = $('.ch-bottom')
  const menu = $('.ch-menu')
  const menuBtn = $<HTMLButtonElement>('.ch-top .ch-menu-btn')
  const menuClose = $<HTMLButtonElement>('.ch-menu-close')
  const navEls = [...root.querySelectorAll<HTMLAnchorElement>('.ch-link')]
  const pipEls = [...root.querySelectorAll<HTMLButtonElement>('.ch-pip')]
  const menuLinks = [...root.querySelectorAll<HTMLAnchorElement>('.ch-ml')]
  const soundBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')]
  const motionBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]')]
  const score = $('.ch-score')
  const readN = $('.ch-score > .ch-sc-n b')
  const readL = $('.ch-score > .ch-sc-l')
  const readB = $('.ch-score > .ch-sc-b')
  const barEl = $('.ch-sc-bar i')

  // ---------------------------------------------------------------- navigation

  root.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLElement>('[data-go]')
    if (!a || !root.contains(a)) return
    e.preventDefault()
    const id = a.dataset.go!
    const fromMenu = menuOpen && menu.contains(a)
    if (menuOpen) closeMenu(false)
    sound.blip(a.matches('.ch-cta, .ch-menu-cta') ? 5 : Math.max(0, indexOf(id)))
    if (indexOf(id) >= 0) engine.land(id)
    // keyboard activation (detail 0) hands focus on to the chapter's heading;
    // a tap in the rundown returns focus to Menu, the control that opened it
    const keyboard = e.detail === 0
    if (keyboard && (fromMenu || a.matches('.ch-link, .ch-pip, .ch-bug') || a.hasAttribute('data-focus')))
      engine.focusChapter(id)
    else if (fromMenu) menuBtn.focus({ preventScroll: true })
  })

  // ---------------------------------------------------------- the score bug

  let lastIndex = -1
  let cueIndex = -1
  const letter = (l: Element, b: Element, i: number) => {
    const s = slots[i]
    if (!s) return false
    l.textContent = s.def.label
    b.textContent = biz(s.def.id, s.def.label)
    return true
  }
  const showRead = (i: number, cue = false) => {
    if (!letter(readL, readB, i)) return
    readN.textContent = pad(i + 1)
    score.classList.toggle('is-cue', cue)
  }

  // One width per cell: the widest label and the widest business name,
  // measured in an invisible copy that takes the same type. The bug is
  // anchored right, so a cell that changed width would slide every pip
  // sideways under the pointer (and under the focus ring). Measured again
  // once the fonts arrive and whenever a breakpoint changes the type.
  const pL = $('.ch-sc-probe .ch-sc-l')
  const pB = $('.ch-sc-probe .ch-sc-b')
  const fit = () => {
    let lw = 0
    let bw = 0
    for (let i = 0; i < total; i++) {
      if (!letter(pL, pB, i)) continue
      lw = Math.max(lw, pL.getBoundingClientRect().width)
      bw = Math.max(bw, pB.getBoundingClientRect().width)
    }
    if (lw > 0) score.style.setProperty('--lw', `${Math.ceil(lw)}px`)
    if (bw > 0) score.style.setProperty('--bw', `${Math.ceil(bw)}px`)
  }
  fit()
  document.fonts?.ready.then(fit).catch(() => {})
  for (const q of ['(max-width: 1100px)', '(max-width: 820px)', '(max-width: 560px)', '(max-width: 400px)']) {
    const mq = matchMedia(q)
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', fit)
    else mq.addListener?.(fit)
  }
  pipEls.forEach((b, i) => {
    const cue = () => {
      cueIndex = i
      showRead(i, i !== lastIndex)
    }
    const uncue = () => {
      if (cueIndex !== i) return
      cueIndex = -1
      if (lastIndex >= 0) showRead(lastIndex)
    }
    b.addEventListener('pointerenter', e => {
      if ((e as PointerEvent).pointerType !== 'touch') cue()
    })
    b.addEventListener('pointerleave', uncue)
    b.addEventListener('focus', cue)
    b.addEventListener('blur', uncue)
  })

  // --------------------------------------------------------------------- crowd

  const syncSound = (on: boolean) => {
    for (const b of soundBtns) {
      b.setAttribute('aria-pressed', String(on))
      const st = b.querySelector('.ch-tgl-st')
      if (st) st.textContent = on ? MICROCOPY.audioOn : MICROCOPY.audioOff
    }
  }
  for (const b of soundBtns) b.addEventListener('click', () => sound.toggle())
  sound.onChange.push(syncSound)
  syncSound(sound.enabled)

  // -------------------------------------------------------------------- motion

  const syncMotion = () => {
    document.documentElement.classList.toggle('motion-off', !motionOn)
    engine.motion = motionOn
    for (const b of motionBtns) {
      b.setAttribute('aria-pressed', String(motionOn))
      const st = b.querySelector('.ch-tgl-st')
      if (st) st.textContent = motionOn ? MICROCOPY.audioOn : MICROCOPY.audioOff
    }
    window.dispatchEvent(new CustomEvent('hark:motion', { detail: { on: motionOn } }))
  }
  for (const b of motionBtns)
    b.addEventListener('click', () => {
      motionOn = !motionOn
      rememberMotion(motionOn)
      sound.blip(motionOn ? 4 : 1)
      syncMotion()
    })
  syncMotion()

  // ------------------------------------------------------------ the rundown

  let menuOpen = false
  let menuTimer = 0
  const calm = () => reduced || !motionOn
  const focusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button')].filter(el => !el.hidden && el.getClientRects().length > 0)
  const openMenu = () => {
    if (menuOpen) return
    menuOpen = true
    clearTimeout(menuTimer)
    menu.hidden = false
    // flush the closed state so the band sweeps in
    void menu.offsetWidth
    ch.classList.add('is-menu')
    menuBtn.setAttribute('aria-expanded', 'true')
    holdInert('menu', [
      document.getElementById('stages'),
      document.getElementById('track'),
      document.querySelector<HTMLElement>('.skip-link'),
      top,
      bottom,
    ])
    engine.lenis?.stop()
    // the rundown is opaque: hold the frame once the band has covered it
    menuTimer = window.setTimeout(() => menuOpen && holdScene('menu'), calm() ? 0 : 420)
    menu.scrollTop = 0
    const now = menuLinks[lastIndex] ?? menuLinks[0]
    now?.focus({ preventScroll: true })
    sound.blip(2)
  }
  const closeMenu = (restoreFocus = true) => {
    if (!menuOpen) return
    menuOpen = false
    clearTimeout(menuTimer)
    ch.classList.remove('is-menu')
    menuBtn.setAttribute('aria-expanded', 'false')
    releaseInert('menu')
    releaseScene('menu')
    engine.lenis?.start()
    menuTimer = window.setTimeout(() => {
      if (!menuOpen) menu.hidden = true
    }, calm() ? 0 : 320)
    if (restoreFocus) menuBtn.focus({ preventScroll: true })
  }
  menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))
  menuClose.addEventListener('click', () => closeMenu())
  // capture: the dialog's own trap runs ahead of the no-`inert` fallback in inert.ts
  window.addEventListener(
    'keydown',
    e => {
      if (!menuOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    },
    true,
  )
  // widening past the menu breakpoint closes the rundown (the full nav is back)
  const narrow = matchMedia(MENU_QUERY)
  const onNarrow = (e: MediaQueryListEvent) => {
    if (!e.matches) closeMenu(false)
  }
  if (typeof narrow.addEventListener === 'function') narrow.addEventListener('change', onNarrow)
  else narrow.addListener?.(onNarrow)

  // -------------------------------------------------------------------- update

  let lastBar = -1
  return {
    update(frame: Frame, state: EngineState) {
      // the whole story, as a thin yellow bar: a compositor-only transform,
      // written only when it moves by more than a hair
      const p = frame.progress
      if (Math.abs(p - lastBar) > 0.0006 || (p >= 1 && lastBar < 1) || (p <= 0 && lastBar > 0)) {
        lastBar = p
        barEl.style.transform = `scaleX(${p.toFixed(4)})`
      }

      if (state.index === lastIndex) return
      const slot = state.slots[state.index]
      if (!slot) return
      lastIndex = state.index
      // a pip still under the pointer keeps its cue (only a cue while it names another chapter)
      if (cueIndex < 0) showRead(state.index)
      else showRead(cueIndex, cueIndex !== state.index)
      pipEls.forEach((b, i) => {
        b.classList.toggle('is-on', i === state.index)
        b.classList.toggle('is-past', i < state.index)
        if (i === state.index) b.setAttribute('aria-current', 'step')
        else b.removeAttribute('aria-current')
      })
      const id = slot.def.id
      navEls.forEach(a => {
        const on = a.dataset.go === id
        a.classList.toggle('is-on', on)
        if (on) a.setAttribute('aria-current', 'location')
        else a.removeAttribute('aria-current')
      })
      menuLinks.forEach((a, i) => {
        a.classList.toggle('is-on', i === state.index)
        if (i === state.index) a.setAttribute('aria-current', 'location')
        else a.removeAttribute('aria-current')
      })
      ch.dataset.chapter = id
    },
  }
}
