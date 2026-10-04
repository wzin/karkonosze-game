import { Container, Texture } from 'pixi.js';

/** Easing curves, p in 0..1. */
export const ease = {
  linear: (p: number) => p,
  outQuad: (p: number) => 1 - (1 - p) * (1 - p),
  inQuad: (p: number) => p * p,
  outCubic: (p: number) => 1 - (1 - p) ** 3,
  inOutSine: (p: number) => -(Math.cos(Math.PI * p) - 1) / 2,
  /** Overshoots past 1 and settles back. */
  outBack: (p: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
  },
  /** A springy wobble that settles at 1. */
  outElastic: (p: number) => {
    if (p === 0 || p === 1) return p;
    return 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

interface Tween {
  age: number;
  delay: number;
  dur: number;
  ease: (p: number) => number;
  step?: (v: number) => void;
  done?: () => void;
}

/**
 * Frame-driven tweens and timers. Owners call update(dt) from their own update and clear() when
 * they go away, so no callback can reach a destroyed display object.
 */
export class Tweens {
  private list: Tween[] = [];

  /** Calls `step(eased p)` every frame for `dur` seconds, then `done`. */
  add(
    dur: number,
    step: (v: number) => void,
    opts: { ease?: (p: number) => number; delay?: number; done?: () => void } = {},
  ): void {
    this.list.push({ age: 0, dur: Math.max(dur, 1e-4), delay: opts.delay ?? 0, ease: opts.ease ?? ease.outCubic, step, done: opts.done });
  }

  /** Runs `done` after `sec` seconds; wait(0) runs it on the next update (a one-frame defer). */
  wait(sec: number, done: () => void): void {
    this.list.push({ age: 0, dur: 0, delay: Math.max(sec, 0), ease: ease.linear, done });
  }

  update(dt: number): void {
    if (this.list.length === 0) return;
    const finished: Tween[] = [];
    // iterate over a snapshot: callbacks may add new tweens
    for (const tw of [...this.list]) {
      tw.age += dt;
      const t = tw.age - tw.delay;
      if (t < 0) continue;
      const p = tw.dur === 0 ? 1 : Math.min(t / tw.dur, 1);
      tw.step?.(tw.ease(p));
      if (p >= 1) finished.push(tw);
    }
    if (finished.length === 0) return;
    this.list = this.list.filter((tw) => !finished.includes(tw));
    for (const tw of finished) tw.done?.();
  }

  clear(): void {
    this.list = [];
  }
}

export interface ParticleOpts {
  vx?: number;
  vy?: number;
  /** px/s² downwards (negative floats up). */
  gravity?: number;
  /** Velocity kept per second (1 = no drag). */
  drag?: number;
  spin?: number;
  life: number;
  delay?: number;
  fade?: boolean;
  /** Scale at the end of life, relative to the start. */
  endScale?: number;
  /** Sideways sway amplitude (px/s) for rising embers. */
  sway?: number;
}

interface Particle extends Required<ParticleOpts> {
  view: Container;
  age: number;
  baseScale: number;
  baseAlpha: number;
  phase: number;
}

/** Simple ballistic particles: each child flies, spins, fades and is destroyed at the end of its life. */
export class ParticleLayer extends Container {
  private particles: Particle[] = [];

  spawn(view: Container, opts: ParticleOpts): void {
    const p: Particle = {
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 1,
      spin: 0,
      delay: 0,
      fade: true,
      endScale: 1,
      sway: 0,
      ...opts,
      view,
      age: 0,
      baseScale: view.scale.x,
      baseAlpha: view.alpha,
      phase: Math.random() * Math.PI * 2,
    };
    view.visible = p.delay <= 0;
    this.addChild(view);
    this.particles.push(p);
  }

  get count(): number {
    return this.particles.length;
  }

  update(dt: number): void {
    if (this.particles.length === 0) return;
    const alive: Particle[] = [];
    for (const p of this.particles) {
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) {
          alive.push(p);
          continue;
        }
        p.view.visible = true;
      }
      p.age += dt;
      if (p.age >= p.life) {
        p.view.destroy({ children: true });
        continue;
      }
      const k = p.age / p.life;
      const drag = p.drag ** dt;
      p.vx *= drag;
      p.vy = p.vy * drag + p.gravity * dt;
      p.view.x += (p.vx + (p.sway ? Math.sin(p.age * 3 + p.phase) * p.sway : 0)) * dt;
      p.view.y += p.vy * dt;
      p.view.rotation += p.spin * dt;
      p.view.scale.set(p.baseScale * (1 + (p.endScale - 1) * k));
      if (p.fade) p.view.alpha = p.baseAlpha * (1 - k * k);
      alive.push(p);
    }
    this.particles = alive;
  }

  clearAll(): void {
    for (const p of this.particles) p.view.destroy({ children: true });
    this.particles = [];
  }
}

let softDot: Texture | null = null;

/** White radial gradient (opaque centre, transparent rim); tint it for glows, halos and sparks. */
export function softDotTexture(): Texture {
  if (softDot) return softDot;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return Texture.WHITE;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  softDot = Texture.from(canvas);
  return softDot;
}

const remapCache = new WeakMap<Texture, Map<string, Texture>>();

/** Per pixel: luminance 0..1 and alpha 0..255 in, grey value 0..255 and alpha 0..255 out. */
type Remap = (lum: number, alpha: number) => [number, number];

/** Luminance percentile (0..1) over the texture's opaque pixels. */
type Percentile = (q: number) => number;

/**
 * A greyscale copy of `tex` with every pixel passed through `fn`, cached per texture and `key`.
 * Falls back to `tex` itself when its pixels cannot be read (missing asset, tainted canvas).
 */
function remapTexture(tex: Texture, key: string, make: (pct: Percentile) => Remap): Texture {
  if (tex === Texture.WHITE) return tex;
  let byKey = remapCache.get(tex);
  if (!byKey) {
    byKey = new Map();
    remapCache.set(tex, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;
  const resource = tex.source.resource as CanvasImageSource | undefined;
  const { x, y, width, height } = tex.frame;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g || !resource) return tex;
  try {
    g.drawImage(resource, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const fn = make(percentiles(d));
    for (let i = 0; i < d.length; i += 4) {
      const [v, a] = fn((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, d[i + 3]);
      d[i] = d[i + 1] = d[i + 2] = Math.round(v);
      d[i + 3] = Math.round(a);
    }
    g.putImageData(img, 0, 0);
  } catch (err) {
    console.warn('[glass] could not read a texture, using it as it is', err);
    return tex;
  }
  const out = Texture.from(canvas);
  byKey.set(key, out);
  return out;
}

/** Luminance histogram of the pixels at least half opaque, read as percentiles. */
function percentiles(d: Uint8ClampedArray): Percentile {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    hist[Math.round(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11)] += 1;
    n += 1;
  }
  return (q) => {
    const want = q * n;
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= want) return v / 255;
    }
    return 1;
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * A pale copy of the orange glob that keeps its shading and alpha, so a tint shows the tint colour
 * instead of multiplying it with the original's orange.
 */
export function paleTexture(tex: Texture): Texture {
  // the glob's oranges sit high on the scale: stretch them into 140..255
  return remapTexture(tex, 'pale', () => (lum, a) => [140 + 115 * clamp01((lum - 0.35) / 0.6), a]);
}

/**
 * The frosted white vessels, split for tinting: `body` has its shading stretched over the texture's
 * own range (5th..98th percentile → 30..100 %) so a tint still shows the form, `shine` keeps only the
 * brightest few per cent as white highlights, drawn untinted on top. Percentiles, not fixed levels:
 * some shapes are almost pure white, others mid-grey.
 */
export function vesselTextures(tex: Texture): { body: Texture; shine: Texture } {
  return {
    body: remapTexture(tex, 'body', (pct) => {
      const lo = pct(0.05);
      const hi = Math.max(pct(0.98), lo + 0.05);
      return (lum, a) => [255 * (0.3 + 0.7 * clamp01((lum - lo) / (hi - lo))), a];
    }),
    shine: remapTexture(tex, 'shine', (pct) => {
      const from = pct(0.93);
      const to = Math.max(pct(0.995), from + 0.01);
      return (lum, a) => [255, a * smoothstep(from, to, lum)];
    }),
  };
}

/** Linear blend of two 0xRRGGBB colours. */
export function mixColor(a: number, b: number, k: number): number {
  const t = Math.min(1, Math.max(0, k));
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

/** Quadratic Bézier point. */
export function bezier(
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** Dev only: lets the smoke test find a non-Button target (jar, mould) under `window.__bk.buttons`. */
export function registerDevTarget(name: string, center: () => { x: number; y: number }): () => void {
  if (!import.meta.env.DEV) return () => {};
  const bk = (window.__bk ??= { sceneId: null });
  const buttons = (bk.buttons ??= {});
  buttons[name] = center;
  return () => {
    if (buttons[name] === center) delete buttons[name];
  };
}
