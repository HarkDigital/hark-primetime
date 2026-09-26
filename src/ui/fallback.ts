import { BRAND, CONTACT, MICROCOPY } from '../content'
import { CHAPTER_COPY_IDS, buildChapterCopy } from '../core/srContent'
import { CHAPTERS } from '../chapters/index'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'
import { releaseScene } from './prefs'

/*
 * The plain HTML version, for browsers without WebGL2 (and the last resort
 * if boot fails or the GPU context is gone for good): every chapter's copy,
 * in story order, visible, as a printed GAME-DAY PROGRAM. A navy cover with
 * the network bug, "Game-day program" and the concept tag; then one page per
 * segment, each headed by its running order ("03 · Starting Eleven ·
 * Services") on a slanted yellow tab; condensed italic caps for heads,
 * Barlow for text, Chivo Mono for the small print; chalk on navy, the links
 * first-down yellow. Same copy as the live site, verbatim, from srContent
 * (buildChapterCopy). Styled by the .fb-* rules in ui.css.
 *
 * Landmarks: the banner <header> sits just before <main id="track">, so
 * "Skip to content" lands on the program itself, past the navigation.
 */

const BUSINESS: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}
const pad = (n: number) => String(n).padStart(2, '0')

export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  document.documentElement.classList.remove('is-rotate', 'motion-off')
  unmountRotateGate()
  // boot can fail while the loader or the menu still holds the page inert: let go
  releaseInert('loader')
  releaseInert('menu')
  releaseScene('menu')
  document.getElementById('loader')?.remove()
  document.getElementById('gl')?.remove()
  // the live chrome drives a story that is no longer there
  document.getElementById('chrome')?.replaceChildren()
  window.dispatchEvent(new Event('hark:fallback'))
  root.style.pointerEvents = 'auto'
  root.inert = false
  root.removeAttribute('aria-hidden')

  document.getElementById('fb-head')?.remove()
  const header = document.createElement('header')
  header.className = 'fb-head'
  header.id = 'fb-head'
  header.innerHTML = `
    <div class="fb-bar">
      <a class="fb-brand" href="#hero" aria-label="${BRAND.name}, top of page">
        <span class="fb-tile" aria-hidden="true">${markSvg('fb-tile-svg')}</span>
        <span class="fb-brand-text" aria-hidden="true">${WORDMARK}${CONCEPT_TAG}</span>
      </a>
      <nav class="fb-nav" aria-label="Primary">
        <a class="fb-link" href="#work">Work</a>
        <a class="fb-link" href="#services">Services</a>
        <a class="fb-link" href="#contact">Contact</a>
        <a class="hud-btn fb-cta" href="${CONTACT.href}">Start a project</a>
      </nav>
    </div>
    <div class="fb-cover" aria-hidden="true">
      <p class="fb-cover-k"><i></i>Game-day program</p>
      <p class="fb-cover-t"><span>Hark</span><span class="fb-cover-b"><span>Primetime</span></span></p>
      <p class="fb-cover-s">${MICROCOPY.signalEyebrow}</p>
    </div>`
  root.parentNode?.insertBefore(header, root)

  root.innerHTML = ''
  root.classList.add('fb')
  // a fresh skip link: the live one's handler focuses a chapter heading that is gone
  const skip = document.querySelector<HTMLAnchorElement>('.skip-link')
  if (skip) {
    const fresh = skip.cloneNode(true) as HTMLAnchorElement
    fresh.href = '#track'
    skip.replaceWith(fresh)
  }
  const order = CHAPTERS.map(c => c.id).filter(id => CHAPTER_COPY_IDS.includes(id))
  for (const id of CHAPTER_COPY_IDS) if (!order.includes(id)) order.push(id)
  order.forEach((id, i) => {
    const copy = buildChapterCopy(id, true)
    if (!copy) return
    // heading Tab stops only drive the live story
    copy.querySelectorAll('h1[tabindex], h2[tabindex]').forEach(h => h.removeAttribute('tabindex'))
    // item "stops" only steer the live story; here they're just text
    copy.querySelectorAll<HTMLAnchorElement>('a[data-anchor][href^="#"]:not([data-land])').forEach(a => {
      const span = document.createElement('span')
      span.textContent = a.textContent
      a.replaceWith(span)
    })
    const label = CHAPTERS.find(c => c.id === id)?.label ?? ''
    const sec = document.createElement('section')
    sec.className = `fb-sec fb-sec--${id}`
    sec.id = id
    const heading = copy.querySelector<HTMLElement>('h1, h2')
    if (heading) {
      heading.id = `fb-${id}-title`
      sec.setAttribute('aria-labelledby', heading.id)
    }
    const kicker = document.createElement('p')
    kicker.className = 'fb-k'
    kicker.setAttribute('aria-hidden', 'true')
    kicker.innerHTML = `<span class="fb-k-n">${pad(i + 1)}</span><span class="fb-k-l">${label}</span><span class="fb-k-b">${BUSINESS[id] ?? ''}</span>`
    sec.append(kicker, copy)
    root.appendChild(sec)
  })

  const foot = document.createElement('footer')
  foot.className = 'fb-foot'
  foot.innerHTML = `
    <span class="fb-foot-mark" aria-hidden="true">${markSvg('fb-foot-svg')}</span>
    <p class="fb-foot-t">${BRAND.tagline}</p>
    <p class="fb-foot-m" aria-hidden="true">Final · Thanks for watching</p>`
  root.appendChild(foot)
  window.scrollTo(0, 0)
}
