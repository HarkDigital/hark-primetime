import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { drawMark } from '../kit/type'

/*
 * Post-processing: Render → Sanitize (NaN guard) → Bloom → Output → FINAL.
 *
 * PRIMETIME's final pass is a network broadcast camera:
 *   - a clean broadcast grade: navy-lifted blacks, a touch of saturation and
 *     contrast, a light vignette, sensor grain, lens fringing at the edges
 *   - a WHIP-PAN smear (params.glitch): horizontal motion blur a chapter can
 *     punch on fast camera whips
 *   - the chapter cut is a REPLAY STINGER: a navy band with yellow and white
 *     speed stripes sweeps diagonally across the frame, the Hark mark rides
 *     in its middle at the boundary, and the band sweeps out the far side.
 *     Scrolling back plays it in reverse (the engine sets cutSide).
 *
 * Keep the Post API (params / resetParams / setSize / render / compileAsync
 * / setFadeTone) and the uTransition / uFade / uFlash / uGlitch uniforms.
 */

/** The final pass runs AFTER the sRGB output pass: its colours are display (sRGB) values. */
const srgb = (c: THREE.ColorRepresentation) => new THREE.Color(c).convertLinearToSRGB()

function markTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')!
  drawMark(ctx, 16, 16, 480, '#ffffff', '#ffd23f')
  const t = new THREE.CanvasTexture(c)
  // sampled raw: the final pass works in display values
  t.colorSpace = THREE.NoColorSpace
  return t
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tMark: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    /** 0..1, peaks exactly at a chapter boundary (engine-driven) */
    uTransition: { value: 0 },
    /** -1 before the boundary (band sweeps in), +1 after (band sweeps out) */
    uCutSide: { value: -1 },
    /** 0..1 whip-pan smear */
    uGlitch: { value: 0 },
    uAberration: { value: 0.0012 },
    uGrain: { value: 0.022 },
    uVignette: { value: 0.28 },
    uGrade: { value: 1 },
    /** 0..1 wash to white */
    uFlash: { value: 0 },
    /** 0..1 fade to uFadeColor (reduced-motion cuts) */
    uFade: { value: 0 },
    uCutColor: { value: srgb('#0b1a36') },
    uFadeColor: { value: srgb('#060a14') },
    uAccent: { value: srgb('#ffd23f') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tMark;
    uniform float uTime, uDpr, uTransition, uCutSide, uGlitch, uAberration, uGrain, uVignette, uGrade, uFlash, uFade;
    uniform vec2 uResolution;
    uniform vec3 uCutColor, uFadeColor, uAccent;
    varying vec2 vUv;

    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

    vec3 sampleScene(vec2 uv, vec2 c) {
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * uAberration).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * uAberration).b;
      return col;
    }

    // a stripe between a and b along d, anti-aliased by px
    float band(float d, float a, float b, float px) {
      return smoothstep(a - px, a + px, d) * (1.0 - smoothstep(b - px, b + px, d));
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float aspect = uResolution.x / max(uResolution.y, 1.0);
      float px = 1.5 / max(uResolution.y, 1.0);

      // whip-pan: horizontal motion blur
      float g = clamp(uGlitch, 0.0, 1.0);
      vec3 col;
      if (g > 0.002) {
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 9; i++) {
          float o = (float(i) / 8.0 - 0.5) * g * 0.07;
          acc += sampleScene(uv + vec2(o, 0.0), c);
        }
        col = acc / 9.0;
      } else {
        col = sampleScene(uv, c);
      }

      // ---- the replay stinger ----
      float t = clamp(uTransition, 0.0, 1.0);
      if (t > 0.001) {
        float phi = uCutSide < 0.0 ? 0.5 * t : 1.0 - 0.5 * t;
        const float SLANT = 0.45;
        // across-the-band coordinate (in screen heights), tilted like a /
        float d = c.x * aspect + c.y * SLANT;
        float E = aspect * 0.5 + SLANT * 0.5 + 0.36;
        float e1 = clamp(phi * 2.0, 0.0, 1.0);
        float e2 = clamp(phi * 2.0 - 1.0, 0.0, 1.0);
        // ease the edges (fast through the middle of the frame)
        e1 = e1 * e1 * (3.0 - 2.0 * e1);
        e2 = e2 * e2 * (3.0 - 2.0 * e2);
        float L = mix(-E, E, e1);
        float T = mix(-E, E, e2);

        // the scene smears ahead of the leading edge / behind the trailing one
        float near = exp(-max(d - L, 0.0) * 9.0) * step(L, d) + exp(-max(T - d, 0.0) * 9.0) * step(d, T);
        if (near > 0.02) {
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 7; i++) {
            float o = (float(i) / 6.0 - 0.5) * 0.08 * near;
            acc += texture2D(tDiffuse, uv + vec2(o, 0.0)).rgb;
          }
          col = mix(col, acc / 7.0, near);
        }

        float inBand = band(d, T, L, px);
        // band interior: navy with a light falloff and speed lines parallel to the edges
        float lines = smoothstep(0.86, 0.98, fract((d - L * 0.6) * 5.0)) * 0.08;
        float shade = 0.75 + 0.5 * (0.5 + c.y);
        vec3 inner = uCutColor * shade + vec3(lines);
        // diagonal sheen travelling with the band
        inner += vec3(0.05, 0.07, 0.12) * exp(-abs(d - mix(T, L, 0.5)) * 3.0);
        // the mark rides in the middle of the frame at the boundary
        float ms = 0.36 + 0.06 * (phi - 0.5);
        vec2 mu = vec2(c.x * aspect, c.y) / ms + 0.5;
        if (mu.x > 0.0 && mu.x < 1.0 && mu.y > 0.0 && mu.y < 1.0) {
          vec4 mk = texture2D(tMark, mu);
          float show = smoothstep(0.2, 0.42, phi) * (1.0 - smoothstep(0.58, 0.8, phi));
          inner = mix(inner, mk.rgb, mk.a * show);
        }
        col = mix(col, inner, inBand);

        // speed stripes at both edges: yellow, white, thin yellow
        float y1 = band(d, L, L + 0.045, px) + band(d, T - 0.045, T, px);
        float w1 = band(d, L + 0.07, L + 0.086, px) + band(d, T - 0.086, T - 0.07, px);
        float y2 = band(d, L + 0.115, L + 0.123, px) + band(d, T - 0.123, T - 0.115, px);
        col = mix(col, uAccent, clamp(y1 + y2, 0.0, 1.0));
        col = mix(col, vec3(0.97), clamp(w1, 0.0, 1.0));
      }

      // ---- broadcast grade ----
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = mix(vec3(luma), col, 1.08);
      graded = mix(graded, graded * graded * (3.0 - 2.0 * graded), 0.12);
      graded += vec3(0.004, 0.008, 0.02) * (1.0 - luma);
      col = mix(col, graded, uGrade);

      col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
      float v = 1.0 - smoothstep(0.4, 1.1, length(c * vec2(1.0, 0.85)) * 1.35);
      col *= mix(1.0, 0.6 + 0.4 * v, uVignette);
      col += (hash(vUv * uResolution + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

/** minimum seconds between two white-flash onsets (WCAG 2.3.1) */
const FLASH_GAP = 0.4

export type PostParams = {
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  aberration: number
  grain: number
  vignette: number
  /** whip-pan smear 0..1 */
  glitch: number
  /** white wash 0..1 */
  flash: number
  exposure: number
  /** broadcast grade amount 0..1 */
  grade: number
}

/** Bloom only catches HDR (> ~1.0): lamps, LEDs, speculars. */
export const POST_DEFAULTS: PostParams = {
  bloomStrength: 0.5,
  bloomRadius: 0.32,
  bloomThreshold: 0.95,
  aberration: 0.0012,
  grain: 0.022,
  vignette: 0.28,
  glitch: 0,
  flash: 0,
  exposure: 1,
  grade: 1,
}

/**
 * Scrubs NaN/Inf and clamps runaway HDR right after the scene render. A single
 * bad fragment would otherwise smear across the whole frame through bloom.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }
  `,
}

export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  final: ShaderPass
  /**
   * Chapters write targets here every frame (the engine resets them to
   * defaults first); values are damped so nothing pops at a cut.
   */
  params: PostParams = { ...POST_DEFAULTS }
  private current: PostParams = { ...POST_DEFAULTS }
  transition = 0
  /** -1 before a boundary, +1 after (engine-driven): the stinger's direction */
  cutSide = -1
  fade = 0
  private lastFlashAt = -1e9
  private flashLive = false
  private flashOk = true

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** skip MSAA (retina / mobile: already supersampled; MSAA half-float targets are huge) */
    noMsaa: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: noMsaa ? 0 : 4,
    })
    this.composer = new EffectComposer(renderer, rt)
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(new ShaderPass(SanitizeShader))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.45, 0.95)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.final = new ShaderPass(FinalShader)
    this.final.uniforms.tMark.value = markTexture()
    this.composer.addPass(this.final)
  }

  /** Colour the stinger band and the reduced-motion fade. */
  setCutColor(color: THREE.ColorRepresentation) {
    ;(this.final.uniforms.uCutColor.value as THREE.Color).copy(srgb(color))
  }

  /** Engine hook (kept for compatibility). */
  setFadeTone(_tone: number) {}

  resetParams() {
    Object.assign(this.params, POST_DEFAULTS)
  }

  /**
   * Compile every post-processing shader in parallel so the first composer
   * render doesn't block on synchronous links.
   */
  compileAsync(): Promise<unknown> {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const b = this.bloom as unknown as Record<string, unknown>
    const mats: THREE.Material[] = []
    const add = (m: unknown) => {
      if (m && (m as THREE.Material).isMaterial) mats.push(m as THREE.Material)
    }
    for (const pass of this.composer.passes) add((pass as unknown as { material?: unknown }).material)
    for (const m of (b.separableBlurMaterials as unknown[]) ?? []) add(m)
    add(b.compositeMaterial)
    add(b.blendMaterial)
    add(b.materialHighPassFilter)
    add(b.copyMaterial)
    return Promise.all(mats.map(m => this.renderer.compileAsync(new THREE.Mesh(quad.geometry, m), cam).catch(() => {})))
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2)
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr)
    this.final.uniforms.uDpr.value = dpr
  }

  render(dt: number, time: number) {
    const k = 1 - Math.exp(-6 * dt)
    const c = this.current
    const p = this.params
    for (const key of Object.keys(p) as (keyof PostParams)[]) {
      // flash & glitch respond instantly so chapters can punch them
      c[key] = key === 'flash' || key === 'glitch' ? p[key] : c[key] + (p[key] - c[key]) * k
    }
    // flash budget (WCAG 2.3.1): a flash starting within FLASH_GAP of the last is dropped
    if (c.flash > 0.02) {
      if (!this.flashLive) {
        this.flashLive = true
        this.flashOk = time - this.lastFlashAt >= FLASH_GAP
        if (this.flashOk) this.lastFlashAt = time
      }
      if (!this.flashOk) c.flash = 0
    } else this.flashLive = false
    this.bloom.strength = c.bloomStrength
    this.bloom.radius = c.bloomRadius
    this.bloom.threshold = c.bloomThreshold
    this.bloom.enabled = c.bloomStrength > 0.01
    this.renderer.toneMappingExposure = c.exposure
    const u = this.final.uniforms
    u.uTime.value = time
    u.uTransition.value = this.transition
    u.uCutSide.value = this.cutSide
    u.uGlitch.value = c.glitch
    u.uAberration.value = c.aberration
    u.uGrain.value = c.grain
    u.uVignette.value = c.vignette
    u.uGrade.value = c.grade
    u.uFlash.value = c.flash
    u.uFade.value = this.fade
    this.composer.render(dt)
  }
}
