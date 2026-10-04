import { Container, Graphics, Rectangle, Sprite, Text, Texture, type DestroyOptions } from 'pixi.js';
import { GlowFilter } from 'pixi-filters/glow';
import { sprite, type AssetRegistry } from '../../core/Assets';
import { DESIGN } from '../../core/Layout';
import { Theme } from '../../ui/Theme';
import { HITS, dist, type OreType, type Vein } from './rules';

type Rng = () => number;
type Point = { x: number; y: number };

export const VEIN_SCALE = 0.5;
/** Smallest tap target around a vein, px (the brief asks for at least 160). */
export const VEIN_HIT_MIN = 180;
const VEIN_ART: Record<OreType, { alias: string; w: number; h: number; tint: number }> = {
  iron: { alias: 'mine/vein_iron', w: 512, h: 356, tint: 0x8a5a3a },
  uranium: { alias: 'mine/vein_uranium', w: 379, h: 400, tint: 0x5a7a4a },
};
const URANIUM_GLOW = 0x8dff5a;
/** Glow alpha on a lit uranium vein. */
const GLOW_LIT = 0.8;
const PUNCH_S = 0.18;
const POP_S = 0.32;

export function easeOutCubic(p: number): number {
  return 1 - (1 - p) ** 3;
}

export function lerpColor(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(((a >> shift) & 0xff) + (((b >> shift) & 0xff) - ((a >> shift) & 0xff)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Fraction of `rate`-per-second exponential smoothing covered in `dt`. */
export function follow(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** A sprite of `alias` scaled to `height`, or a tinted placeholder of that size. */
export function artOfHeight(assets: AssetRegistry, alias: string, height: number, tint: number): Sprite {
  const size = assets.size(alias) ?? { w: height, h: height };
  const k = height / size.h;
  const s = sprite(assets, alias, { w: size.w * k, h: height, tint });
  if (assets.has(alias)) s.scale.set(k);
  return s;
}

/** White radial falloff for additive glows; tint it. */
export function radialTexture(size = 256): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return Texture.WHITE;
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

/**
 * One ore vein at its (x, y): the art at half size, cracks that grow with every hit and, on uranium, a
 * green GlowFilter that shows only while the vein is lit. Three pips for the hits left go on
 * `pipLayer`, outside the lamp filter, so they read on every background; they fade in with the light.
 */
export class VeinView extends Container {
  private readonly art: Sprite;
  private readonly glow: GlowFilter | null = null;
  private readonly cracks = new Graphics();
  private readonly pips = new Graphics();
  private readonly baseScale: number;
  private readonly artH: number;
  private punch = 0;
  private popT = -1;
  /** 0 in the dark .. 1 in the light, eased. */
  private lit = 0;
  private t = 0;

  readonly veinId: number;
  readonly type: OreType;

  constructor(
    assets: AssetRegistry,
    vein: Vein,
    private readonly rng: Rng,
    pipLayer: Container,
  ) {
    super();
    this.veinId = vein.id;
    this.type = vein.type;
    const type = vein.type;
    this.position.set(vein.x, vein.y);
    const spec = VEIN_ART[type];
    const w = spec.w * VEIN_SCALE;
    this.artH = spec.h * VEIN_SCALE;
    this.art = sprite(assets, spec.alias, { w, h: this.artH, tint: spec.tint });
    if (assets.has(spec.alias)) this.art.scale.set(VEIN_SCALE);
    this.art.anchor.set(0.5);
    this.baseScale = this.art.scale.x;
    if (type === 'uranium') {
      this.glow = new GlowFilter({
        distance: 24,
        outerStrength: 3,
        innerStrength: 0.4,
        color: URANIUM_GLOW,
        quality: 0.2,
        alpha: 0,
      });
      this.glow.enabled = false;
      this.art.filters = [this.glow];
    }
    this.addChild(this.art, this.cracks);
    this.pips.position.set(vein.x, vein.y + this.artH / 2 + 20);
    this.pips.alpha = 0;
    this.pips.eventMode = 'none';
    pipLayer.addChild(this.pips);
    this.drawPips(HITS);

    const hw = Math.max(w, VEIN_HIT_MIN) / 2;
    const hh = Math.max(this.artH, VEIN_HIT_MIN) / 2;
    this.hitArea = new Rectangle(-hw, -hh, hw * 2, hh * 2);
    this.eventMode = 'static';
    this.cursor = 'pointer';
  }

  get gone(): boolean {
    return this.popT >= POP_S;
  }

  /** A pick hit: the vein jolts, cracks deeper and loses a pip. */
  onHit(hitsLeft: number): void {
    this.punch = PUNCH_S;
    this.drawCracks(HITS - hitsLeft);
    this.drawPips(hitsLeft);
  }

  /** Mined out: swells and vanishes. */
  pop(): void {
    this.popT = 0;
    this.eventMode = 'none';
  }

  update(dt: number, lit: boolean): void {
    this.t += dt;
    this.lit += ((lit && this.popT < 0 ? 1 : 0) - this.lit) * follow(10, dt);
    // the pips are the brightest thing on a vein: hide them in the dark so they give nothing away
    this.pips.alpha = this.lit;
    if (this.glow) {
      this.glow.alpha = GLOW_LIT * this.lit;
      this.glow.outerStrength = 3 + 0.8 * Math.sin(this.t * 3.1);
      this.glow.enabled = this.glow.alpha > 0.01;
    }
    if (this.popT >= 0) {
      this.popT += dt;
      const p = Math.min(this.popT / POP_S, 1);
      this.scale.set(1 + 0.35 * easeOutCubic(p));
      this.alpha = 1 - p;
      this.visible = p < 1;
      this.pips.visible = this.visible;
      return;
    }
    if (this.punch > 0) {
      this.punch = Math.max(0, this.punch - dt);
      const k = this.punch / PUNCH_S;
      this.art.scale.set(this.baseScale * (1 - 0.07 * Math.sin(k * Math.PI)));
      this.art.rotation = 0.06 * Math.sin(k * Math.PI * 3) * k;
    }
  }

  override destroy(options?: DestroyOptions): void {
    this.glow?.destroy();
    this.pips.destroy();
    super.destroy(options);
  }

  private drawPips(hitsLeft: number): void {
    const gap = 28;
    const w = gap * (HITS - 1) + 32;
    this.pips.clear().roundRect(-w / 2, -16, w, 32, 16).fill({ color: Theme.color.night, alpha: 0.7 });
    for (let i = 0; i < HITS; i++) {
      const x = (i - (HITS - 1) / 2) * gap;
      this.pips.circle(x, 0, 8);
      if (i < hitsLeft) this.pips.fill(Theme.color.star);
      else this.pips.stroke({ color: Theme.color.paper, width: 2.5, alpha: 0.45 });
    }
  }

  /** `level` jagged cracks from near the centre outwards, one more per hit. */
  private drawCracks(level: number): void {
    const r = this.artH * 0.42;
    for (let n = 0; n < 2; n++) {
      let x = (this.rng() - 0.5) * r * 0.5;
      let y = (this.rng() - 0.5) * r * 0.5;
      const a = this.rng() * Math.PI * 2;
      const pts = [x, y];
      for (let s = 0; s < 3 + level; s++) {
        const turn = a + (this.rng() - 0.5) * 1.2;
        x += Math.cos(turn) * r * 0.22;
        y += Math.sin(turn) * r * 0.22;
        pts.push(x, y);
      }
      this.cracks.poly(pts, false).stroke({ color: 0x120c08, width: 4, alpha: 0.85, join: 'round', cap: 'round' });
      this.cracks.poly(pts, false).stroke({ color: 0xffe2a8, width: 1.2, alpha: 0.45, join: 'round' });
    }
  }
}

/** Needle swing by Geiger level, radians from straight up, and how hard it twitches. */
const NEEDLE = { angle: [-1.15, -0.45, 0.25, 0.95], jitter: [0.03, 0.14, 0.22, 0.3] };
/** Pivot and dial radius of the needle painted on the art (geiger.webp, 448×453). */
const DIAL = { x: 236, y: 262, r: 68, artH: 453 };
const DIAL_FACE = 0xe7d3a8;

/** The Geiger counter in the corner, `size` px tall, whose needle twitches harder near uranium. */
export class GeigerView extends Container {
  private readonly body = new Container();
  private readonly needle = new Graphics();
  private level = 0;
  private needleAngle = NEEDLE.angle[0];
  private aim = NEEDLE.angle[0];
  private nextTwitch = 0;

  constructor(
    assets: AssetRegistry,
    private readonly rng: Rng,
    size = 120,
  ) {
    super();
    const art = artOfHeight(assets, 'mine/geiger', size, 0x56606a);
    const k = size / DIAL.artH;
    // the art has its own needle: paint the dial over it and swing ours on the same pivot
    const face = new Graphics()
      .moveTo(-DIAL.r * k, 0)
      .arc(0, 0, DIAL.r * k, Math.PI, Math.PI * 2)
      .closePath()
      .fill(DIAL_FACE);
    face.position.set(DIAL.x * k, DIAL.y * k);
    const len = DIAL.r * k * 0.92;
    this.needle
      .moveTo(0, 0)
      .lineTo(0, -len)
      .stroke({ color: 0x8c1d1d, width: 2.5, cap: 'round' })
      .circle(0, 0, 3.2)
      .fill(0x2a2018);
    this.needle.position.copyFrom(face.position);
    this.body.addChild(art, face, this.needle);
    this.addChild(this.body);
  }

  setLevel(level: number): void {
    this.level = level;
  }

  update(dt: number): void {
    this.nextTwitch -= dt;
    if (this.nextTwitch <= 0) {
      this.nextTwitch = 0.05 + this.rng() * 0.07;
      this.aim = NEEDLE.angle[this.level] + (this.rng() - 0.5) * 2 * NEEDLE.jitter[this.level];
    }
    this.needleAngle += (this.aim - this.needleAngle) * follow(25, dt);
    this.needle.rotation = this.needleAngle;
    const shake = this.level === 3 ? 1.6 : 0;
    this.body.position.set((this.rng() - 0.5) * shake, (this.rng() - 0.5) * shake);
  }
}

/** Oil left in the lamp: a label and a 600×18 bar that drains from ember to red. Origin: the bar's top-left. */
export class OilBar extends Container {
  static readonly W = 600;
  static readonly H = 18;
  private readonly fill = new Graphics();
  private t = 0;

  constructor(label: string) {
    super();
    const text = new Text({
      text: label,
      style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 24, fill: Theme.color.paper },
    });
    text.anchor.set(1, 0.5);
    text.position.set(-16, OilBar.H / 2);
    const left = -16 - text.width - 22;
    const backing = new Graphics()
      .roundRect(left, -12, OilBar.W - left + 14, OilBar.H + 24, (OilBar.H + 24) / 2)
      .fill({ color: Theme.color.night, alpha: 0.7 });
    const track = new Graphics()
      .roundRect(0, 0, OilBar.W, OilBar.H, OilBar.H / 2)
      .fill({ color: 0x000000, alpha: 0.5 })
      .stroke({ color: Theme.color.paper, alpha: 0.35, width: 2 });
    this.addChild(backing, text, track, this.fill);
  }

  /** @param f oil left, 0..1 */
  set(f: number, dt: number): void {
    this.t += dt;
    const w = OilBar.W * Math.max(0, Math.min(1, f));
    this.fill.clear();
    if (w > 0) this.fill.roundRect(0, 0, Math.max(w, 4), OilBar.H, Math.min(OilBar.H / 2, w / 2)).fill(lerpColor(Theme.color.bad, Theme.color.ember, f));
    this.fill.alpha = f < 0.2 ? 0.55 + 0.45 * Math.abs(Math.sin(this.t * 6)) : 1;
  }
}

interface Particle {
  view: Graphics;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  life: number;
  max: number;
  grow: number;
  align: boolean;
}

const SPARK_COLORS = [0xffd27a, 0xffb347, 0xfff2c0, 0xff9a3c];

/** Short-lived bits: pick sparks, steam from a doused lamp, rock dust, splashes. */
export class Particles extends Container {
  private readonly list: Particle[] = [];

  constructor(private readonly rng: Rng) {
    super();
  }

  sparks(x: number, y: number, n = 10): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (this.rng() - 0.5) * Math.PI * 1.4;
      const v = 320 + this.rng() * 420;
      const g = new Graphics()
        .roundRect(-10, -2.5, 20, 5, 2.5)
        .fill(SPARK_COLORS[Math.floor(this.rng() * SPARK_COLORS.length)])
        .roundRect(-5, -1, 10, 2, 1)
        .fill(0xffffff);
      g.blendMode = 'add';
      this.add(g, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 1300, drag: 1.5, life: 0.35 + this.rng() * 0.3, align: true });
    }
  }

  steam(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const g = new Graphics().circle(0, 0, 10 + this.rng() * 8).fill({ color: 0xdfe6ea, alpha: 0.35 });
      this.add(g, x + (this.rng() - 0.5) * 30, y - 10, {
        vx: (this.rng() - 0.5) * 60,
        vy: -60 - this.rng() * 80,
        gravity: 0,
        drag: 1,
        life: 0.8 + this.rng() * 0.6,
        grow: 1.2,
      });
    }
  }

  dust(n = 40): void {
    for (let i = 0; i < n; i++) {
      const g = new Graphics().circle(0, 0, 2 + this.rng() * 4).fill({ color: 0x8a7a66, alpha: 0.8 });
      this.add(g, this.rng() * DESIGN.w, 100 + this.rng() * 80, {
        vx: (this.rng() - 0.5) * 40,
        vy: 60 + this.rng() * 200,
        gravity: 600,
        drag: 0.5,
        life: 1 + this.rng() * 0.8,
      });
    }
  }

  splash(x: number, y: number): void {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (this.rng() - 0.5) * 2.2;
      const v = 90 + this.rng() * 110;
      const g = new Graphics().circle(0, 0, 2.5).fill({ color: 0xcfeeff, alpha: 0.8 });
      this.add(g, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 900, drag: 0, life: 0.35 });
    }
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.view.destroy();
        this.list.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.view.x += p.vx * dt;
      p.view.y += p.vy * dt;
      if (p.align) p.view.rotation = Math.atan2(p.vy, p.vx);
      const f = p.life / p.max;
      p.view.alpha = Math.min(1, f * 2);
      if (p.grow) p.view.scale.set(1 + p.grow * (1 - f));
    }
  }

  clear(): void {
    for (const p of this.list) p.view.destroy();
    this.list.length = 0;
  }

  private add(
    view: Graphics,
    x: number,
    y: number,
    o: { vx: number; vy: number; gravity: number; drag: number; life: number; grow?: number; align?: boolean },
  ): void {
    view.position.set(x, y);
    this.addChild(view);
    this.list.push({ view, ...o, max: o.life, grow: o.grow ?? 0, align: o.align ?? false });
  }
}

const BAT = { width: 190, speed: 470, hitR: 95, every: { min: 15, max: 20 } };

/**
 * A bat crossing the gallery every 15–20 s on a wavy line. It is a dark silhouette in the dark and
 * shows its colours in the lamp light. update() reports a bump into the lamp once per pass.
 */
export class Bat extends Container {
  private readonly art: Sprite;
  private readonly baseScale: number;
  private flying = false;
  private wait: number;
  private t = 0;
  private dir = 1;
  private baseY = 0;
  private amp = 0;
  private freq = 0;
  private bumped = false;

  constructor(
    assets: AssetRegistry,
    private readonly rng: Rng,
    firstIn: number,
  ) {
    super();
    const size = assets.size('mine/bat') ?? { w: 600, h: 400 };
    const k = BAT.width / size.w;
    this.art = sprite(assets, 'mine/bat', { w: BAT.width, h: size.h * k, tint: 0x3a3440 });
    if (assets.has('mine/bat')) this.art.scale.set(k);
    this.art.anchor.set(0.5);
    this.baseScale = this.art.scale.y;
    this.addChild(this.art);
    this.visible = false;
    this.wait = firstIn;
  }

  /** @param light brightness of the lamp light at a point, 0..1 */
  update(dt: number, lamp: Point, light: (p: Point) => number): boolean {
    if (!this.flying) {
      this.wait -= dt;
      if (this.wait > 0) return false;
      this.launch();
    }
    this.t += dt;
    const travel = BAT.speed * this.t;
    this.x = this.dir > 0 ? -BAT.width + travel : DESIGN.w + BAT.width - travel;
    this.y = this.baseY + this.amp * Math.sin(this.freq * this.t);
    this.art.scale.y = this.baseScale * (0.7 + 0.3 * Math.abs(Math.sin(this.t * 16)));
    this.art.rotation = 0.12 * Math.sin(this.freq * this.t + 1) * this.dir;
    const v = 0.16 + 0.84 * light(this);
    this.art.tint = lerpColor(0x000000, 0xffffff, v);
    if (travel > DESIGN.w + BAT.width * 2) {
      this.flying = false;
      this.visible = false;
      this.wait = BAT.every.min + this.rng() * (BAT.every.max - BAT.every.min);
      return false;
    }
    if (!this.bumped && dist(this, lamp) < BAT.hitR) {
      this.bumped = true;
      return true;
    }
    return false;
  }

  private launch(): void {
    this.flying = true;
    this.visible = true;
    this.bumped = false;
    this.t = 0;
    this.dir = this.rng() < 0.5 ? 1 : -1;
    this.baseY = 260 + this.rng() * 560;
    this.amp = 50 + this.rng() * 70;
    this.freq = 2.2 + this.rng() * 1.2;
  }
}

const DRIP = { formS: 0.7, gravity: 1500, hitDx: 60 };

/**
 * A leak in the roof at `x`: every `periodS` a drop swells at the top and falls. update() reports
 * 'hit' when the drop reaches the lamp's height within 60 px of it, 'splash' when it hits bottom.
 */
export class Drip extends Container {
  private readonly drop = new Graphics();
  private timer: number;
  private state: 'wait' | 'form' | 'fall' = 'wait';
  private vy = 0;

  constructor(
    x: number,
    private readonly periodS: number,
    firstIn: number,
    private readonly top: number,
    private readonly bottom: number,
  ) {
    super();
    this.x = x;
    this.drop
      .poly([0, -13, 6, 1, -6, 1])
      .fill({ color: 0xcfeeff, alpha: 0.9 })
      .circle(0, 3, 6.4)
      .fill({ color: 0xcfeeff, alpha: 0.9 })
      .circle(-2, 3, 1.8)
      .fill({ color: 0xffffff, alpha: 0.9 });
    this.drop.visible = false;
    this.addChild(this.drop);
    this.timer = firstIn;
  }

  update(dt: number, lamp: Point): 'hit' | 'splash' | null {
    if (this.state === 'wait') {
      this.timer -= dt;
      if (this.timer > 0) return null;
      this.state = 'form';
      this.timer = 0;
      this.drop.visible = true;
      this.drop.position.set(0, this.top);
    }
    if (this.state === 'form') {
      this.timer += dt;
      const p = Math.min(this.timer / DRIP.formS, 1);
      this.drop.scale.set(0.3 + 0.7 * p, (0.3 + 0.7 * p) * (1 + 0.15 * Math.sin(this.timer * 18) * (1 - p)));
      if (p < 1) return null;
      this.state = 'fall';
      this.vy = 0;
    }
    const prevY = this.drop.y;
    this.vy += DRIP.gravity * dt;
    this.drop.y += this.vy * dt;
    this.drop.scale.set(1, 1 + Math.min(this.vy / 1600, 0.6));
    if (prevY < lamp.y && this.drop.y >= lamp.y && Math.abs(this.x - lamp.x) < DRIP.hitDx) {
      this.rest();
      return 'hit';
    }
    if (this.drop.y >= this.bottom) {
      this.rest();
      return 'splash';
    }
    return null;
  }

  private rest(): void {
    this.state = 'wait';
    this.timer = this.periodS - DRIP.formS;
    this.drop.visible = false;
  }
}
