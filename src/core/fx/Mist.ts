import { Container, Sprite, Texture } from 'pixi.js';
import type { AssetRegistry } from '../Assets';
import { mulberry32 } from '../Rng';

/**
 * Left edges [plain, mirrored] of the two copies of a `w`-wide tile scrolled `offset` px to the
 * left (negative scrolls right). The pair repeats every 2 w and always covers 0..w.
 */
export function wrapPair(offset: number, w: number): [number, number] {
  const o = ((offset % (2 * w)) + 2 * w) % (2 * w);
  const a = (o >= w ? 2 * w : 0) - o;
  return [a, w - o];
}

/** Gentle up-and-down of a drifting band: `amp` px, one swing every `period` s. */
export function bob(t: number, amp: number, period: number, phase = 0): number {
  return amp * Math.sin((t * Math.PI * 2) / period + phase);
}

export interface MistOpts {
  /** The mist art; until it is in the manifest a soft procedural streak stands in. */
  alias: string;
  /** Band height in design px; the art keeps its aspect unless that is narrower than `minWidth`. */
  height: number;
  /** Each copy is at least this wide, so two always cover the view plus any parallax shift. */
  minWidth: number;
  alpha: number;
  tint?: number;
}

/**
 * A soft band of mist that drifts sideways forever: two copies side by side, the second mirrored, so
 * the seam joins an edge with its own mirror image. Its own (0, 0) is the band's left edge at the
 * centre line; place it at x = -(minWidth - view width) / 2 to keep the overscan even.
 */
export class MistBand extends Container {
  private readonly tiles: [Sprite, Sprite];
  private readonly tileW: number;
  private offset = 0;

  constructor(assets: AssetRegistry, opts: MistOpts) {
    super();
    const tex = assets.has(opts.alias) ? assets.texture(opts.alias) : softMist();
    const ky = opts.height / tex.height;
    const kx = Math.max(ky, opts.minWidth / tex.width);
    const plain = new Sprite(tex);
    const mirrored = new Sprite(tex);
    plain.scale.set(kx, ky);
    mirrored.scale.set(-kx, ky);
    for (const s of [plain, mirrored]) {
      s.anchor.set(0, 0.5);
      if (opts.tint !== undefined) s.tint = opts.tint;
    }
    this.tileW = tex.width * kx;
    this.tiles = [plain, mirrored];
    this.alpha = opts.alpha;
    this.eventMode = 'none';
    this.addChild(plain, mirrored);
    this.place();
  }

  /** Moves the mist `px` to the left (negative: to the right). */
  scroll(px: number): void {
    this.offset = (this.offset + px) % (this.tileW * 2);
    this.place();
  }

  private place(): void {
    const [a, b] = wrapPair(this.offset, this.tileW);
    this.tiles[0].x = a;
    // a mirrored sprite extends to the left of its x
    this.tiles[1].x = b + this.tileW;
  }
}

let fallback: Texture | null = null;

/**
 * Stand-in mist, drawn once: overlapping soft white ellipses along a 1024×256 band, faded out towards
 * its top and bottom so no edge ever shows. Tinted and dimmed by the band that uses it.
 */
export function softMist(): Texture {
  if (fallback) return fallback;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  if (!g) return Texture.WHITE;
  const rng = mulberry32(2604);
  for (let i = 0; i < 46; i++) {
    const x = rng() * canvas.width;
    const y = canvas.height / 2 + (rng() - 0.5) * 70;
    const r = 30 + rng() * 56;
    g.save();
    g.translate(x, y);
    g.scale(2.2 + rng() * 3, 1);
    const puff = g.createRadialGradient(0, 0, 0, 0, 0, r);
    puff.addColorStop(0, `rgba(255,255,255,${(0.7 + rng() * 0.3).toFixed(2)})`);
    puff.addColorStop(0.5, `rgba(255,255,255,${(0.35 + rng() * 0.2).toFixed(2)})`);
    puff.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = puff;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // a vertical falloff keeps the band's top and bottom edges invisible
  const fade = g.createLinearGradient(0, 0, 0, canvas.height);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.3, 'rgba(0,0,0,1)');
  fade.addColorStop(0.7, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = fade;
  g.fillRect(0, 0, canvas.width, canvas.height);
  fallback = Texture.from(canvas);
  return fallback;
}
