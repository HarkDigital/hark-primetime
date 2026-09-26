import type { ChapterDef } from '../core/types'

/**
 * The scroll story, in order. `length` is scroll distance in viewport
 * heights; `landing` is where nav jumps land (local progress, on settled
 * copy — keep it clear of the ~6% cut window at each end). Each chapter lives
 * in src/chapters/<id>/ and default-exports a factory returning a Chapter.
 *
 * Primetime labels are the broadcast's segments (Kickoff → Touchdown). The
 * ids are shared with src/core/srContent.ts and the chrome's business names.
 */
export const CHAPTERS: ChapterDef[] = [
  { id: 'hero', label: 'Kickoff', length: 2.6, landing: 0, intro: 0.8, load: () => import('./hero/index') },
  { id: 'work', label: 'Highlights', length: 3.8, landing: 0.12, intro: 0.06, load: () => import('./work/index') },
  { id: 'services', label: 'Starting Eleven', length: 4.2, landing: 0.08, intro: 0.06, load: () => import('./services/index') },
  { id: 'voices', label: 'The Crowd', length: 3.2, landing: 0.07, intro: 0.06, load: () => import('./voices/index') },
  { id: 'shield', label: 'Goal-Line Stand', length: 1.8, landing: 0.45, intro: 0.45, load: () => import('./shield/index') },
  { id: 'process', label: 'The Drive', length: 2.2, landing: 0.17, intro: 0.12, load: () => import('./process/index') },
  { id: 'contact', label: 'Touchdown', length: 1.5, landing: 0.3, intro: 0.3, load: () => import('./contact/index') },
]
