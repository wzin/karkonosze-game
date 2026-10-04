import { Container, Graphics, Rectangle, Sprite, Text, type DestroyOptions } from 'pixi.js';
import { sprite, type AssetRegistry } from '../../core/Assets';
import { Theme } from '../../ui/Theme';
import { mixColor, registerDevTarget, softDotTexture, vesselTextures } from './fx';
import type { ShapeId } from './rules';

/** Design-space layout shared by the scene and its steps. */
export const LAYOUT = {
  /** Pipe tip while the gather sits in the furnace mouth. */
  furnaceTip: { x: 352, y: 600 },
  /** Pipe tip on the workbench stage. */
  stageTip: { x: 790, y: 580 },
  /** Furnace mouth in bg.webp (the lit brick tunnel and the dark opening), measured on the image. */
  furnaceMouth: { x: 250, y: 375, w: 350, h: 400 },
  /** Centre of the dark opening, where the fire glows. */
  furnaceFire: { x: 348, y: 596, rx: 92, ry: 150 },
  /** Bottom centres of the three finished vessels on the table (right side of bg.webp). */
  tableSlots: [1320, 1510, 1700],
  tableY: 728,
  /** Row of jars / moulds: x centres, item bottoms, captions below. */
  rowX: (i: number) => 960 + (i - 2) * 240,
  rowBottom: 1004,
  card: { x: 1000, y: 158, w: 880 },
  order: { x: 40, y: 158, w: 920 },
} as const;

const TIMER_H = 10;

/** Step heading, one-sentence instruction and the step's time bar; top-left origin. */
export class InstructionCard extends Container {
  private readonly bg = new Graphics();
  private readonly heading: Text;
  private readonly body: Text;
  private readonly bar = new Graphics();
  private readonly content = new Container();
  private frac: number | null = null;
  private appear = 1;

  constructor(private readonly w: number) {
    super();
    this.heading = new Text({
      text: '',
      style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 40, fill: Theme.color.paper },
    });
    const style = Theme.text.body(27, Theme.color.emberSoft);
    style.wordWrapWidth = w - 56;
    this.body = new Text({ text: '', style });
    this.content.addChild(this.heading, this.body);
    this.addChild(this.bg, this.content, this.bar);
  }

  set(heading: string, body: string): void {
    this.heading.text = heading;
    this.body.text = body;
    this.heading.position.set(28, 18);
    this.body.position.set(28, 18 + this.heading.height + 2);
    this.appear = 0;
    this.visible = true;
    this.layout();
  }

  /** Remaining time 1..0, or null to hide the bar. */
  setTime(frac: number | null): void {
    this.frac = frac === null ? null : Math.min(1, Math.max(0, frac));
    this.drawBar();
  }

  update(dt: number): void {
    if (this.appear >= 1) return;
    this.appear = Math.min(1, this.appear + dt / 0.35);
    const e = 1 - (1 - this.appear) ** 3;
    this.content.alpha = e;
    this.content.x = (1 - e) * 24;
  }

  private get h(): number {
    return this.body.y + this.body.height + 22 + TIMER_H + 14;
  }

  private layout(): void {
    this.bg
      .clear()
      .roundRect(0, 6, this.w, this.h, 24)
      .fill({ color: Theme.color.night, alpha: 0.35 })
      .roundRect(0, 0, this.w, this.h, 24)
      .fill({ color: Theme.color.night, alpha: 0.82 })
      .stroke({ color: Theme.color.ember, alpha: 0.5, width: 2 });
    this.drawBar();
  }

  private drawBar(): void {
    const g = this.bar.clear();
    if (this.frac === null) return;
    const x = 28;
    const y = this.h - TIMER_H - 18;
    const w = this.w - 56;
    g.roundRect(x, y, w, TIMER_H, TIMER_H / 2).fill({ color: Theme.color.paper, alpha: 0.14 });
    if (this.frac > 0) {
      const urgent = this.frac < 0.25;
      g.roundRect(x, y, Math.max(TIMER_H, w * this.frac), TIMER_H, TIMER_H / 2).fill({
        color: urgent ? Theme.color.bad : Theme.color.ember,
      });
    }
  }
}

/** A short message popping up over the stage (time up, a burst bubble). */
export class Toast extends Container {
  private readonly bg = new Graphics();
  private readonly text: Text;
  private life = 0;
  private age = 0;

  constructor() {
    super();
    const style = Theme.text.body(32, Theme.color.star);
    style.fontWeight = '800';
    style.wordWrapWidth = 820;
    style.align = 'center';
    this.text = new Text({ text: '', style });
    this.text.anchor.set(0.5);
    this.addChild(this.bg, this.text);
    this.visible = false;
  }

  show(msg: string, seconds = 1.6): void {
    this.text.text = msg;
    const w = this.text.width + 72;
    const h = this.text.height + 40;
    this.bg
      .clear()
      .roundRect(-w / 2, -h / 2 + 6, w, h, 28)
      .fill({ color: Theme.color.night, alpha: 0.4 })
      .roundRect(-w / 2, -h / 2, w, h, 28)
      .fill({ color: Theme.color.night, alpha: 0.9 })
      .stroke({ color: Theme.color.star, alpha: 0.7, width: 3 });
    this.life = seconds;
    this.age = 0;
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.age += dt;
    const pIn = Math.min(1, this.age / 0.25);
    const out = Math.max(0, (this.age - this.life + 0.3) / 0.3);
    this.scale.set(0.7 + 0.3 * backOut(pIn));
    this.alpha = Math.min(pIn * 2, 1) * (1 - out);
    if (this.age >= this.life) this.visible = false;
  }
}

/**
 * A pickable item standing on its bottom centre (0, 0): a jar or a mould. Lifts on hover, dips on
 * press, fires onPick on tap. The hit area covers item and caption, at least hitMin each way.
 */
export class Tile extends Container {
  onPick?: () => void;
  private readonly lift = new Container();
  private hover = 0;
  private hoverTarget = 0;
  private pressed = false;
  private readonly unregister: () => void;
  private readonly itemH: number;
  private picked = false;

  constructor(opts: { view: Container; height: number; width: number; caption: string; name: string; kiosk: boolean }) {
    super();
    this.itemH = opts.height;
    this.lift.addChild(opts.view);
    const caption = new Text({
      text: opts.caption,
      style: {
        fontFamily: Theme.font.body,
        fontWeight: '800',
        fontSize: 26,
        fill: Theme.color.paper,
        stroke: { color: Theme.color.night, width: 6, join: 'round' },
      },
    });
    caption.anchor.set(0.5, 0);
    caption.position.set(0, 8);
    this.addChild(this.lift, caption);

    const min = Theme.size.hitMin(opts.kiosk);
    const w = Math.max(opts.width + 24, caption.width + 12, min);
    const h = Math.max(opts.height + 50, min);
    this.hitArea = new Rectangle(-w / 2, -opts.height - 12, w, h);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => (this.hoverTarget = 1));
    this.on('pointerout', () => {
      this.hoverTarget = 0;
      this.pressed = false;
    });
    this.on('pointerdown', () => (this.pressed = true));
    this.on('pointerupoutside', () => (this.pressed = false));
    this.on('pointertap', () => {
      this.pressed = false;
      if (!this.picked) this.onPick?.();
    });
    this.unregister = registerDevTarget(opts.name, () => this.toGlobal({ x: 0, y: -this.itemH / 2 }));
  }

  /** Point in the parent's space where the item's top sits (pigment leaves the jar here). */
  topIn(): { x: number; y: number } {
    return { x: this.x, y: this.y - this.itemH * 0.92 + this.lift.y };
  }

  /** Freeze the row once something is picked: the pick stays lifted, the rest dim. */
  settle(chosen: boolean): void {
    this.picked = true;
    this.eventMode = 'none';
    this.cursor = 'default';
    this.hoverTarget = chosen ? 1.6 : 0;
    this.alpha = chosen ? 1 : 0.45;
  }

  update(dt: number): void {
    this.hover += (this.hoverTarget - this.hover) * Math.min(1, dt * 12);
    this.lift.y = -14 * this.hover;
    const s = this.pressed ? 0.93 : 1 + 0.04 * Math.min(this.hover, 1);
    this.lift.scale.x += (s - this.lift.scale.x) * Math.min(1, dt * 18);
    this.lift.scale.y = this.lift.scale.x;
  }

  /** A quick wobble (the jar being tipped). */
  get item(): Container {
    return this.lift;
  }

  override destroy(options?: DestroyOptions): void {
    this.unregister();
    super.destroy(options);
  }
}

/** Fits a sprite to `h` px tall, standing on its bottom centre. */
export function standing(s: Sprite, h: number): Sprite {
  s.anchor.set(0.5, 1);
  s.scale.set(h / Math.max(s.texture.height, 1));
  return s;
}

/** The round shape is much wider than the others: keep it from swallowing the table. */
const SHAPE_SCALE: Partial<Record<ShapeId, number>> = { kula: 0.8 };

/**
 * A finished (or offered) vessel standing on its bottom centre, `h` px tall: a shadow, an optional
 * light pool in the glass colour, and the glass itself (shaded body tinted + white shine), which is
 * the part that glows. Call update(dt) to let the light pool breathe.
 */
export class Vessel extends Container {
  readonly glass = new Container();
  readonly glassTint: number;
  private readonly pool: Sprite;
  private poolTarget = 0;
  private t = Math.random() * 6;

  constructor(assets: AssetRegistry, shape: ShapeId, tint: number, h: number) {
    super();
    this.glassTint = tint;
    const height = h * (SHAPE_SCALE[shape] ?? 1);
    const alias = `glass/shape_${shape}`;
    if (assets.has(alias)) {
      const tex = vesselTextures(assets.texture(alias));
      const body = standing(new Sprite(tex.body), height);
      body.tint = tint;
      const shine = standing(new Sprite(tex.shine), height);
      shine.alpha = 0.85;
      this.glass.addChild(body, shine);
    } else {
      const body = sprite(assets, alias, { w: height * 0.45, h: height, tint });
      body.anchor.set(0.5, 1);
      this.glass.addChild(body);
    }
    const w = this.glass.width;
    const shadow = new Graphics().ellipse(0, 0, Math.max(36, w * 0.55), 12).fill({ color: Theme.color.night, alpha: 0.5 });

    this.pool = new Sprite(softDotTexture());
    this.pool.anchor.set(0.5);
    this.pool.blendMode = 'add';
    this.pool.tint = mixColor(tint, 0xffffff, 0.35);
    this.pool.scale.set((Math.max(w, height * 0.6) * 2.2) / 128, (height * 1.5) / 128);
    this.pool.y = -height * 0.5;
    this.pool.alpha = 0;

    this.addChild(this.pool, shadow, this.glass);
  }

  /** The soft light pool behind the glass (the result and the summary turn it on). */
  set lit(on: boolean) {
    this.poolTarget = on ? 1 : 0;
  }

  update(dt: number): void {
    this.t += dt;
    const target = this.poolTarget * (0.42 + 0.12 * Math.sin(this.t * 2.4));
    this.pool.alpha += (target - this.pool.alpha) * Math.min(1, dt * 4);
  }
}

/** 36 dashes around a circle, as in the brief's target contour. */
export function dashedRing(g: Graphics, r: number, color: number, width: number, alpha = 1): Graphics {
  const n = 36;
  const step = (Math.PI * 2) / n;
  g.clear();
  for (let i = 0; i < n; i++) {
    const a = i * step;
    g.moveTo(Math.cos(a) * r, Math.sin(a) * r).arc(0, 0, r, a, a + step * 0.55);
  }
  return g.stroke({ color, width, alpha, cap: 'round' });
}

function backOut(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}
