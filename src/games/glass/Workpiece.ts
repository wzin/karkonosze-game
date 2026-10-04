import { Container, Graphics, Sprite } from 'pixi.js';
import { sprite, type AssetRegistry } from '../../core/Assets';
import { mixColor, paleTexture, softDotTexture } from './fx';

/** Radius of the fresh gather of glass on the pipe, design px. */
export const R0 = 34;
/** The bubble is drawn at this radius and scaled to `r`. */
const BASE = 100;
/** The bubble's centre sits this far (× r) right of the pipe tip, so it grows away from the pipe. */
const CENTRE = 0.92;
/** Pipe tip in pipe.webp (1230 px wide): the rod ends 8 px before the right edge. */
const PIPE_TIP_X = 1222 / 1230;

const HOT = 0xff8a2a;
const FIRE = 0xffe7a0;
const COLD = 0x8a807a;

/**
 * The blowpipe from the left with the glass on its tip. The container's origin is the pipe tip, so
 * moving it moves pipe and glass together. The glass is two copies of glass/glob: the original
 * (hot, orange) and a pale copy that takes the mineral tint; colouring cross-fades between them.
 */
export class Workpiece extends Container {
  readonly pipe: Sprite;
  /** Centred on the glass; steps squash `body` and read the centre through bubbleCentre(). */
  private readonly bubble = new Container();
  private readonly body = new Container();
  private readonly halo: Sprite;
  private readonly hot: Sprite;
  private readonly cool: Sprite;
  private readonly shine: Graphics;
  private radius = R0;
  private glowLevel = 0.5;
  private glassTint = 0xffffff;
  private colour = 0;
  private t = 0;
  /** 0..1 extra wobble while blowing. */
  wobble = 0;

  constructor(assets: AssetRegistry) {
    super();
    this.pipe = sprite(assets, 'glass/pipe', { w: 1230, h: 14, tint: 0x5a6068 });
    this.pipe.anchor.set(PIPE_TIP_X, 0.5);
    if (!assets.has('glass/pipe')) this.pipe.anchor.set(1, 0.5);
    this.pipe.scale.y *= 1.15;

    this.halo = new Sprite(softDotTexture());
    this.halo.anchor.set(0.5);
    this.halo.blendMode = 'add';
    this.halo.tint = HOT;

    this.hot = sprite(assets, 'glass/glob', { w: 200, h: 200, tint: 0xff9a3c });
    this.cool = new Sprite(paleTexture(this.hot.texture));
    for (const s of [this.hot, this.cool]) {
      s.anchor.set(0.5);
      // the gather is a drop with its tip up: turn the tip towards the pipe
      s.rotation = -Math.PI / 2;
      s.scale.set((BASE * 2) / Math.max(s.texture.width, 1));
    }
    this.cool.alpha = 0;

    this.shine = new Graphics()
      .ellipse(0, 0, 26, 12)
      .fill({ color: 0xffffff, alpha: 0.55 })
      .ellipse(18, 30, 7, 5)
      .fill({ color: 0xffffff, alpha: 0.35 });
    this.shine.position.set(-12, -48);
    this.shine.rotation = -0.5;

    this.body.addChild(this.hot, this.cool, this.shine);
    this.bubble.addChild(this.halo, this.body);
    this.addChild(this.pipe, this.bubble);
    this.reset();
  }

  /** Fresh gather: small, hot, uncoloured. */
  reset(): void {
    this.colour = 0;
    this.glassTint = 0xffffff;
    this.wobble = 0;
    this.body.scale.set(1);
    this.bubble.visible = true;
    this.bubble.alpha = 1;
    this.setRadius(R0);
    this.setGlow(0.5);
    this.applyColour();
  }

  get r(): number {
    return this.radius;
  }

  setRadius(r: number): void {
    this.radius = Math.max(0, r);
    this.bubble.scale.set(this.radius / BASE);
    this.bubble.x = this.radius * CENTRE;
  }

  /** Bubble centre in this container's parent space. */
  bubbleCentre(): { x: number; y: number } {
    return { x: this.x + this.bubble.x, y: this.y + this.bubble.y };
  }

  /** Centre for any target radius (the dashed ring is drawn there). */
  centreFor(r: number): { x: number; y: number } {
    return { x: this.x + r * CENTRE, y: this.y };
  }

  /** 0 = cold ash grey, 0.5 = ember orange, 1 = white-hot fire. */
  setGlow(level: number): void {
    this.glowLevel = Math.min(1, Math.max(0, level));
    this.applyColour();
  }

  /** Cross-fades the hot glass to `tint` by `k` (0..1). */
  setColour(tint: number, k: number): void {
    this.glassTint = tint;
    this.colour = Math.min(1, Math.max(0, k));
    this.applyColour();
  }

  get bubbleVisible(): boolean {
    return this.bubble.visible;
  }

  set bubbleVisible(v: boolean) {
    this.bubble.visible = v;
  }

  set bubbleAlpha(a: number) {
    this.bubble.alpha = a;
  }

  /** Non-uniform squash of the glass (the mould pressing it). */
  squash(sx: number, sy: number): void {
    this.body.scale.set(sx, sy);
  }

  update(dt: number): void {
    this.t += dt;
    // molten glass never sits still: a slow breathing, more of it while blowing
    const breathe = 1 + Math.sin(this.t * 2.2) * 0.012 * (1 - this.colour) + Math.sin(this.t * 31) * 0.02 * this.wobble;
    this.bubble.scale.set((this.radius / BASE) * breathe, (this.radius / BASE) / breathe);
    const flicker = 0.85 + 0.15 * Math.sin(this.t * 9.3) * Math.sin(this.t * 3.1);
    this.halo.alpha = this.haloAlpha() * flicker;
  }

  private haloAlpha(): number {
    const g = this.glowLevel;
    return (0.25 + 0.6 * g) * (1 - this.colour * 0.75);
  }

  private applyColour(): void {
    const g = this.glowLevel;
    // ash dims the glass, fire washes it towards white-yellow
    this.hot.tint = g < 0.5 ? mixColor(COLD, 0xffffff, smooth(0.08, 0.42, g)) : mixColor(0xffffff, FIRE, smooth(0.62, 1, g));
    this.hot.alpha = 1 - this.colour;
    this.cool.alpha = this.colour * 0.96;
    this.cool.tint = this.glassTint;
    const glowTint = g > 0.62 ? mixColor(HOT, FIRE, smooth(0.62, 1, g)) : HOT;
    this.halo.tint = this.colour > 0 ? mixColor(glowTint, this.glassTint, this.colour) : glowTint;
    this.halo.scale.set(((BASE * 2) / 128) * (1.5 + 0.9 * g));
    this.halo.alpha = this.haloAlpha();
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
