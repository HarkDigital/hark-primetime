import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'

/*
 * Primetime sound: the CROWD, heard from the broadcast booth (WebAudio only,
 * no files).
 *
 *   bed      a stadium crowd: two decorrelated pink-noise streams (left and
 *            right) through a low "murmur" band and a vowel-ish "voices"
 *            band (the ahh of 45,000 people), under a faint rumble. Each
 *            layer swells on its own slow breath; every 9–16 s the whole
 *            crowd rises a little and settles (a play developing). Scrolling
 *            lifts and brightens it a touch (scroll velocity), and each
 *            chapter sets its own energy (the goal-line stand is tense and
 *            loud, the touchdown bright).
 *   cut()    a crowd ROAR swells through the replay stinger, then a distant
 *            stadium ORGAN plays one soft chord in the new chapter's key, far
 *            back in a big room (rate-limited: a fast scroll through several
 *            chapters never stacks them).
 *   blip()   a referee's whistle, gentle: a short, soft, low-passed pea
 *            trill (a sine with a fast flutter), never piercing.
 *   tone()   a pure sine a chapter may ask for (also via 'hark:tone' events).
 *
 * Off by default. Sound only ever starts from a real gesture: the toggle's
 * own click / tap / Enter / Space. A remembered "on" (localStorage) waits for
 * the first real activation (a click or tap, or Enter / Space on a control;
 * never Tab, arrows or scrolling). Faded out and suspended while the tab is
 * hidden. On iOS the audio session is set to "playback" so the silent switch
 * doesn't swallow it. Levels stay low, behind a gentle compressor.
 *
 * Keep the API: enabled, onChange, toggle(), update(), cut(), blip(), tone().
 */

const STORE_KEY = 'hark-primetime:sound'

function stored(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

interface Mood {
  /** crowd energy (bed level multiplier) */
  energy: number
  /** voices band centre (Hz): higher = more excited */
  voice: number
  /** organ chord (MIDI root; a fifth and an octave ride on it) */
  organ: number
}

const MOODS: Record<string, Mood> = {
  hero: { energy: 1, voice: 900, organ: 60 },
  work: { energy: 0.9, voice: 860, organ: 62 },
  services: { energy: 0.92, voice: 880, organ: 64 },
  voices: { energy: 1.05, voice: 940, organ: 65 },
  // the goal-line stand: tense, low and loud
  shield: { energy: 1.3, voice: 760, organ: 57 },
  process: { energy: 0.95, voice: 900, organ: 67 },
  // the touchdown: bright
  contact: { energy: 1.2, voice: 1020, organ: 72 },
}

const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const CONTROL = 'a[href], button, [role="button"], [role="switch"], summary, input, select, textarea'
const MASTER_LEVEL = 0.6
/** ≈ −37 dBFS dry at the master: a low bed you notice when it swells */
const BED_LEVEL = 0.16
const TONE_MAX = 0.03
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function setAudioSession(type: string) {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = type
  } catch {
    /* not supported */
  }
}

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private dry!: GainNode
  private room!: GainNode
  private bed!: GainNode
  private voiceBands: BiquadFilterNode[] = []
  private pink: AudioBuffer | null = null
  private white: AudioBuffer | null = null
  private toneOsc: OscillatorNode | null = null
  private toneGain: GainNode | null = null

  private chapter = 'hero'
  private moodKey = ''
  private mood: Mood = MOODS.hero
  private lift = 0
  private lastLiftAt = 0
  private nextSwell = 0
  private lastCut = -10
  private lastOrgan = -10
  private lastBlip = -10
  private suspendTimer = 0
  private hidden = typeof document !== 'undefined' && document.hidden
  /** a remembered "on" waiting for the first real gesture */
  private armed = false
  private gestureBound = false
  private toneHz = 440
  private toneLevel = 0

  constructor() {
    this.armed = stored() === true
    if (this.armed) this.waitForGesture()
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.applyRunning()
    })
    window.addEventListener('hark:tone', e => {
      const d = (e as CustomEvent<{ hz?: number; level?: number }>).detail
      if (d && typeof d.hz === 'number') this.tone(d.hz, d.level ?? 0)
    })
    // the static page took over (no GPU): silence, without touching the stored choice
    window.addEventListener('hark:fallback', () => this.setEnabled(false))
  }

  /** was sound on last visit? (it still needs a gesture to start) */
  get remembered() {
    return stored() === true
  }

  /** Flip the crowd on/off. Call from a user gesture (click / key). */
  toggle() {
    this.armed = false
    this.setEnabled(!this.enabled)
    try {
      localStorage.setItem(STORE_KEY, this.enabled ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  /** Follow the story: the crowd's mood per chapter, a lift from scroll speed, slow swells. */
  update(frame: Frame, state: EngineState) {
    const slot = state.slots[state.index]
    if (slot) this.chapter = slot.def.id
    const ctx = this.live()
    if (!ctx) return
    if (this.chapter !== this.moodKey) this.setMood(this.chapter, ctx)
    const now = ctx.currentTime

    // scrolling: the crowd leans in (a little louder, a little brighter)
    if (now - this.lastLiftAt > 0.15) {
      this.lastLiftAt = now
      const v = Math.min(3, Math.abs(frame.velocity || 0))
      const lift = Math.round(v * 10) / 30
      if (Math.abs(lift - this.lift) > 0.02) {
        this.lift = lift
        this.bed.gain.setTargetAtTime(BED_LEVEL * this.mood.energy * (1 + 0.45 * lift), now, 0.5)
        this.voiceBands.forEach((bp, ch) => bp.frequency.setTargetAtTime(this.mood.voice * (ch ? 1.12 : 1) * (1 + 0.14 * lift), now, 0.6))
      }
    }

    // now and then the crowd rises with a play, and settles
    if (!this.nextSwell) this.nextSwell = now + rand(5, 9)
    if (now >= this.nextSwell) {
      this.swell(ctx, now, rand(0.06, 0.11), rand(1.4, 2.2), rand(2.2, 3.4))
      this.nextSwell = now + rand(9, 16)
    }
  }

  /** A chapter cut: the crowd roars through the stinger, then a distant organ chord. */
  cut(_from: number, _to: number) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    const since = now - this.lastCut
    this.lastCut = now
    // a fast scroll through several cuts: one roar keeps rolling, no stacking
    if (since < 0.7) return
    this.swell(ctx, now, 0.24 * this.mood.energy, 0.32, 1.5)
    if (now - this.lastOrgan > 1.6) {
      this.lastOrgan = now
      const m = MOODS[this.chapter] ?? this.mood
      this.organ(ctx, now + 0.42, m.organ)
    }
  }

  /** A referee's whistle, soft (nav, buttons). `pitch` lifts it a little. No-op while off. */
  blip(pitch = 0) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBlip < 0.08) return
    this.lastBlip = now
    const p = Math.max(0, Math.min(8, Math.round(pitch)))
    const f = 1650 * Math.pow(2, p / 36)
    const len = 0.16
    // the whistle: a sine with the pea's fast flutter
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(f * 0.97, now)
    o.frequency.linearRampToValueAtTime(f, now + 0.03)
    const fl = ctx.createOscillator()
    fl.frequency.value = 34
    const flAmt = ctx.createGain()
    flAmt.gain.value = f * 0.025
    fl.connect(flAmt).connect(o.frequency)
    // the flutter also shivers the level a little
    const trem = ctx.createGain()
    trem.gain.value = 0.8
    const trAmt = ctx.createGain()
    trAmt.gain.value = 0.2
    fl.connect(trAmt).connect(trem.gain)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2600
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.03, now + 0.018)
    g.gain.setValueAtTime(0.03, now + len - 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, now + len)
    o.connect(trem).connect(lp).connect(g)
    g.connect(this.dry)
    const send = ctx.createGain()
    send.gain.value = 0.35
    g.connect(send).connect(this.room)
    o.start(now)
    fl.start(now)
    o.stop(now + len + 0.02)
    fl.stop(now + len + 0.02)
    // a breath of air through it
    if (this.white) {
      const n = ctx.createBufferSource()
      n.buffer = this.white
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = 3
      const ng = ctx.createGain()
      ng.gain.setValueAtTime(0.0001, now)
      ng.gain.exponentialRampToValueAtTime(0.012, now + 0.01)
      ng.gain.exponentialRampToValueAtTime(0.0001, now + len)
      n.connect(bp).connect(ng).connect(this.dry)
      n.start(now, Math.random() * 3)
      n.stop(now + len + 0.02)
    }
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  /* ------------------------------------------------------------ internals */

  private live() {
    const ctx = this.ctx
    if (!ctx || !this.enabled || this.hidden || ctx.state !== 'running') return null
    return ctx
  }

  private setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    setAudioSession(on ? 'playback' : 'auto')
    if (on) {
      try {
        this.ensureGraph()
      } catch (err) {
        console.warn('[hark] audio unavailable', err)
      }
    }
    this.applyRunning(true)
    for (const fn of this.onChange) fn(on)
  }

  /** Resume + fade in, or fade out + suspend, from enabled / hidden. */
  private applyRunning(greet = false) {
    const ctx = this.ctx
    if (!ctx) return
    clearTimeout(this.suspendTimer)
    const now = ctx.currentTime
    if (this.enabled && !this.hidden) {
      ctx
        .resume()
        .then(() => {
          if (!this.enabled || this.hidden) return
          if (ctx.state !== 'running') return this.waitForGesture()
          const t = ctx.currentTime
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setValueAtTime(this.master.gain.value, t)
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, 0.7)
          this.moodKey = ''
          this.setMood(this.chapter, ctx)
          this.applyTone()
          this.nextSwell = t + rand(5, 9)
          // "on": the crowd greets you with a small rise and one soft whistle
          if (greet) {
            this.swell(ctx, t + 0.1, 0.12, 0.6, 1.8)
            this.blip(2)
          }
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.25)
      this.suspendTimer = window.setTimeout(
        () => {
          if (!this.enabled || this.hidden) ctx.suspend().catch(() => {})
        },
        this.hidden ? 300 : 1300,
      )
    }
  }

  /** Start audio on the first real gesture (a remembered "on", or a blocked resume). */
  private waitForGesture() {
    if (this.gestureBound) return
    this.gestureBound = true
    let sx = 0
    let sy = 0
    const events = ['click', 'keydown', 'touchstart', 'touchend'] as const
    const handler = (e: Event) => {
      if (e.type === 'touchstart') {
        const t = (e as TouchEvent).touches[0]
        if (t) {
          sx = t.clientX
          sy = t.clientY
        }
        return
      }
      if (e.type === 'touchend') {
        // a tap, not a scroll or a swipe
        const t = (e as TouchEvent).changedTouches[0]
        if (!t || Math.hypot(t.clientX - sx, t.clientY - sy) > 12) return
      }
      // keyboard: only Enter / Space on a control is "play"; Tab and friends are just moving around
      if (e instanceof KeyboardEvent) {
        if (!ACTIVATE_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
        if (!(e.target as Element | null)?.closest?.(CONTROL)) return
      }
      for (const ev of events) window.removeEventListener(ev, handler, true)
      this.gestureBound = false
      const onToggle = (e.target as Element | null)?.closest?.('[data-sound-toggle]')
      if (this.armed) {
        this.armed = false
        // the toggle's own click decides for itself
        if (!onToggle) this.setEnabled(true)
      } else if (this.enabled) this.applyRunning()
    }
    for (const ev of events) window.addEventListener(ev, handler, { capture: true, passive: true })
  }

  private ensureGraph() {
    if (this.ctx) return
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'playback' })
    this.ctx = ctx
    const sr = ctx.sampleRate

    // master → high-pass → gentle compression → out
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 40
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24
    comp.knee.value = 18
    comp.ratio.value = 3
    comp.attack.value = 0.02
    comp.release.value = 0.5
    this.master.connect(hp).connect(comp).connect(ctx.destination)

    this.dry = ctx.createGain()
    this.dry.connect(this.master)

    // the bowl: a big, dark generated stereo impulse (~3.4 s) with late slap-back
    const irLen = Math.floor(sr * 3.4)
    const ir = ctx.createBuffer(2, irLen, sr)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      let lp = 0
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen
        const k = 0.55 + 0.35 * t // darker as it goes
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k)
        const env = (1 - t) * (1 - t) * (1 - t)
        // the far stands answer ~0.18 s later
        const slap = i > sr * 0.18 && i < sr * 0.24 ? 1.6 : 1
        d[i] = lp * env * slap * (i < sr * 0.03 ? i / (sr * 0.03) : 1)
      }
    }
    const verb = ctx.createConvolver()
    verb.buffer = ir
    this.room = ctx.createGain()
    const wet = ctx.createGain()
    wet.gain.value = 1.2
    this.room.connect(verb).connect(wet).connect(this.master)

    // noise: white (whistle breath) and two decorrelated pinks (the crowd)
    const nLen = Math.floor(sr * 6)
    this.white = ctx.createBuffer(1, nLen, sr)
    const wd = this.white.getChannelData(0)
    for (let i = 0; i < nLen; i++) wd[i] = Math.random() * 2 - 1
    const makePink = () => {
      const b = ctx.createBuffer(1, nLen, sr)
      const d = b.getChannelData(0)
      let b0 = 0
      let b1 = 0
      let b2 = 0
      for (let i = 0; i < nLen; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.99765 * b0 + w * 0.099046
        b1 = 0.963 * b1 + w * 0.2965164
        b2 = 0.57 * b2 + w * 1.0526913
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16
      }
      return b
    }
    const pinks = [makePink(), makePink()]
    this.pink = pinks[0]

    // the crowd bed: L and R streams, each a low murmur + a vowel-ish voices band
    this.bed = ctx.createGain()
    this.bed.gain.value = BED_LEVEL * this.mood.energy
    const merge = ctx.createChannelMerger(2)
    this.voiceBands = [0, 1].map(ch => {
      const src = ctx.createBufferSource()
      src.buffer = pinks[ch]
      src.loop = true
      // murmur: a broad low band
      const mu = ctx.createBiquadFilter()
      mu.type = 'bandpass'
      mu.frequency.value = ch ? 360 : 320
      mu.Q.value = 0.7
      const muG = ctx.createGain()
      muG.gain.value = 0.9
      // voices: a narrower band around the "ahh" formant
      const vo = ctx.createBiquadFilter()
      vo.type = 'bandpass'
      vo.frequency.value = this.mood.voice * (ch ? 1.12 : 1)
      vo.Q.value = 1.3
      const voG = ctx.createGain()
      voG.gain.value = 0.55
      // each band breathes on its own slow swell
      const breathe = (g: GainNode, hz: number, amt: number, delay: number) => {
        const lfo = ctx.createOscillator()
        lfo.frequency.value = hz
        const a = ctx.createGain()
        a.gain.value = amt
        lfo.connect(a).connect(g.gain)
        lfo.start(ctx.currentTime + delay)
      }
      breathe(muG, ch ? 0.071 : 0.053, 0.22, ch * 1.7)
      breathe(voG, ch ? 0.043 : 0.061, 0.2, ch * 2.9)
      src.connect(mu).connect(muG).connect(merge, 0, ch)
      src.connect(vo).connect(voG).connect(merge, 0, ch)
      src.start(0, ch * 2.3)
      return vo
    })
    // the rumble: the bowl itself, very low and quiet
    const rum = ctx.createBufferSource()
    rum.buffer = pinks[1]
    rum.loop = true
    const rumLp = ctx.createBiquadFilter()
    rumLp.type = 'lowpass'
    rumLp.frequency.value = 150
    const rumG = ctx.createGain()
    rumG.gain.value = 0.5
    rum.connect(rumLp).connect(rumG).connect(this.bed)
    rum.start(0, 4.1)
    merge.connect(this.bed).connect(this.dry)
    const bedSend = ctx.createGain()
    bedSend.gain.value = 0.28
    this.bed.connect(bedSend).connect(this.room)

    // a pure tone a chapter may ask for
    this.toneOsc = ctx.createOscillator()
    this.toneOsc.type = 'sine'
    this.toneOsc.frequency.value = this.toneHz
    this.toneGain = ctx.createGain()
    this.toneGain.gain.value = 0
    this.toneOsc.connect(this.toneGain).connect(this.dry)
    this.toneOsc.start()
  }

  private setMood(id: string, ctx: AudioContext) {
    const m = MOODS[id] ?? MOODS.hero
    this.moodKey = id
    this.mood = m
    const now = ctx.currentTime
    // the crowd's energy follows the chapter, slowly
    this.bed.gain.setTargetAtTime(BED_LEVEL * m.energy * (1 + 0.45 * this.lift), now, 1.4)
    this.voiceBands.forEach((bp, ch) => bp.frequency.setTargetAtTime(m.voice * (ch ? 1.12 : 1) * (1 + 0.14 * this.lift), now, 1.4))
  }

  /** the crowd rising together: band-passed pink noise, a slow attack and a long settle */
  private swell(ctx: AudioContext, at: number, level: number, attack: number, release: number) {
    if (!this.pink || level <= 0) return
    const src = ctx.createBufferSource()
    src.buffer = this.pink
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.8
    const f = this.mood.voice
    bp.frequency.setValueAtTime(f * 0.7, at)
    bp.frequency.exponentialRampToValueAtTime(f * 1.25, at + attack)
    bp.frequency.exponentialRampToValueAtTime(f * 0.8, at + attack + release)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(level, at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release)
    src.connect(bp).connect(g)
    g.connect(this.dry)
    const send = ctx.createGain()
    send.gain.value = 0.5
    g.connect(send).connect(this.room)
    const len = attack + release + 0.05
    src.start(at, Math.random() * Math.max(0, this.pink.duration - len - 0.1))
    src.stop(at + len)
  }

  /** a distant stadium organ: one soft chord (root, fifth, octave), mostly room */
  private organ(ctx: AudioContext, at: number, root: number) {
    const out = ctx.createGain()
    out.gain.setValueAtTime(0.0001, at)
    out.gain.exponentialRampToValueAtTime(0.07, at + 0.07)
    out.gain.setValueAtTime(0.07, at + 0.55)
    out.gain.exponentialRampToValueAtTime(0.0001, at + 1.5)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    // a slow Leslie-ish tremolo
    const trem = ctx.createGain()
    trem.gain.value = 0.85
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 5.6
    const lAmt = ctx.createGain()
    lAmt.gain.value = 0.15
    lfo.connect(lAmt).connect(trem.gain)
    trem.connect(lp).connect(out)
    // drawbars: 8', 4', 2 2/3' on each note
    const oscs: OscillatorNode[] = [lfo]
    for (const [n, lvl] of [
      [root, 1],
      [root + 7, 0.7],
      [root + 12, 0.55],
    ] as const) {
      const f = mtof(n)
      for (const [mul, amt] of [
        [1, 0.5],
        [2, 0.3],
        [3, 0.16],
      ] as const) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = f * mul
        const g = ctx.createGain()
        g.gain.value = amt * lvl * 0.3
        o.connect(g).connect(trem)
        oscs.push(o)
      }
    }
    // far back in the bowl: mostly reverb
    const dry = ctx.createGain()
    dry.gain.value = 0.35
    out.connect(dry).connect(this.dry)
    const wet = ctx.createGain()
    wet.gain.value = 0.9
    out.connect(wet).connect(this.room)
    for (const o of oscs) {
      o.start(at)
      o.stop(at + 1.6)
    }
  }

  private applyTone() {
    const ctx = this.ctx
    if (!ctx || !this.toneOsc || !this.toneGain) return
    const now = ctx.currentTime
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.08)
    this.toneGain.gain.setTargetAtTime(this.toneLevel * TONE_MAX, now, 0.12)
  }
}
