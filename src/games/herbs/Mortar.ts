import { Circle, Container, Graphics, Point, Sprite, type FederatedPointerEvent } from 'pixi.js';
import { sprite, type AssetRegistry } from '../../core/Assets';
import type { Audio } from '../../core/Audio';
import { Theme } from '../../ui/Theme';
import { ease, lerp, type Tweens } from './anim';
import { fit } from './parts';
import { grindProgress, type PlantId } from './rules';

/** The mortar is drawn 420 px wide: its 640 px texture scaled by K. */
const MORTAR_W = 420;
const K = MORTAR_W / 640;
/** Inner opening of the bowl in texture px (centre y, half-width, half-height) → local px. */
const OPEN_Y = (55 - 211) * K;
const OPEN_RX = 265 * K;
const OPEN_RY = 26 * K;
/** Centre of the progress ring and of the circle the finger traces, local px. */
const RING_Y = -40;
const RING_R = 300;
const RING_W = 22;
/** Finger guide radius, and the dead zone where the angle would jump about. */
const GUIDE_R = 200;
const DEAD_R = 30;
const GRAB_R = 460;
const PESTLE_H = 250;
/** The grind loop stops this long after the finger stops moving. */
const QUIET = 0.2;
const PASTE = 0x6d8f3a;
const LIQUID = 0x7cc04f;
const FLASK_TINT = 0x7d4fa3;

/**
 * Grinding view centred on (0, 0): stone mortar with the gathered herbs, the pestle following the
 * finger round the bowl, a progress ring and a guide dot until the first turn. Dragging round the
 * centre feeds `grindProgress`; at 1 it calls `onGround(seconds)` (timed from the first movement).
 */
export class Mortar extends Container {
  onGround?: (grindSeconds: number) => void;
  /** Mortar body, contents and pestle; tilted as one piece for the pour. */
  private readonly bowl = new Container();
  private readonly contents = new Container();
  private readonly paste = new Graphics();
  private readonly pestle: Sprite;
  private readonly ring = new Graphics();
  private readonly guide = new Container();
  private readonly herbSprites: { s: Sprite; base: number }[] = [];
  private progress = 0;
  private pestleAngle = -Math.PI / 2;
  private lastAngle: number | null = null;
  private dragging: number | null = null;
  private started = false;
  private finished = false;
  private elapsed = 0;
  private quiet = Infinity;
  private grinding = false;
  private t = 0;

  constructor(
    assets: AssetRegistry,
    private readonly audio: Audio,
    herbs: PlantId[],
  ) {
    super();
    const back = fit(sprite(assets, 'herbs/mortar', { w: 640, h: 422, tint: 0x9aa3a8 }), MORTAR_W, 1000);
    back.anchor.set(0.5);
    const front = fit(sprite(assets, 'herbs/mortar', { w: 640, h: 422, tint: 0x9aa3a8 }), MORTAR_W, 1000);
    front.anchor.set(0.5);
    const frontMask = this.frontShape();
    front.mask = frontMask;

    herbs.forEach((id, i) => {
      const s = fit(sprite(assets, `herbs/plant_${id}`, { w: 200, h: 240, tint: 0x6d9a52 }), 150, 150);
      s.anchor.set(0.5, 0.8);
      const spread = herbs.length > 1 ? i / (herbs.length - 1) - 0.5 : 0;
      s.position.set(spread * OPEN_RX * 1.1, OPEN_Y + 30);
      s.rotation = spread * 0.5;
      this.herbSprites.push({ s, base: s.scale.y });
      this.contents.addChild(s);
    });
    this.contents.addChild(this.paste);

    this.pestle = fit(sprite(assets, 'herbs/pestle', { w: 120, h: 300, tint: 0xb9b2a4 }), 1000, PESTLE_H);
    this.pestle.anchor.set(0.5, 0.85);

    this.bowl.addChild(back, this.contents, this.pestle, front, frontMask);
    this.addChild(this.ring, this.bowl, this.guide);
    this.drawGuide();
    this.placePestle();
    this.drawRing();

    this.eventMode = 'static';
    this.cursor = 'grab';
    this.hitArea = new Circle(0, RING_Y, GRAB_R);
    this.on('pointerdown', (e) => this.grab(e));
    this.on('globalpointermove', (e) => this.drag(e));
    this.on('pointerup', (e) => this.drop(e));
    this.on('pointerupoutside', (e) => this.drop(e));
    this.on('pointercancel', (e) => this.drop(e));
  }

  /** Dev hook for the smoke test: where to circle, in screen (CSS) px. */
  devTarget(): { x: number; y: number; r: number } {
    const c = this.toGlobal(new Point(0, RING_Y));
    const edge = this.toGlobal(new Point(GUIDE_R, RING_Y));
    return { x: c.x, y: c.y, r: Math.hypot(edge.x - c.x, edge.y - c.y) };
  }

  update(dt: number): void {
    this.t += dt;
    if (this.started && !this.finished) this.elapsed += dt;
    this.quiet += dt;
    if (this.grinding && this.quiet > QUIET) {
      this.grinding = false;
      this.audio.stop('herbs.grind');
    }
    if (!this.started) {
      // the guide dot circles the bowl, showing the gesture
      const a = this.t * 2.4 - Math.PI / 2;
      this.guide.position.set(Math.cos(a) * GUIDE_R, RING_Y + Math.sin(a) * GUIDE_R);
      this.guide.rotation = a;
      this.guide.alpha = 0.55 + 0.35 * Math.sin(this.t * 5);
    }
  }

  /** Stops the grind loop (scene exit or the end of grinding). */
  silence(): void {
    if (this.grinding) this.audio.stop('herbs.grind');
    this.grinding = false;
  }

  /**
   * Tilts the bowl over `flask` and pours: the stream arcs from the lip into the neck while the
   * flask fills; `done` runs when the bowl is back down.
   */
  pour(tweens: Tweens, flask: Flask, done: () => void): void {
    const layer = this.parent;
    this.eventMode = 'none';
    this.ring.visible = false;
    if (!layer) return done();
    const stream = new Graphics();
    layer.addChild(stream);
    const from = { x: this.x, y: this.y };
    const to = { x: this.x + 60, y: this.y - 120 };
    const tilt = 0.6;
    tweens.add({
      dur: 0.25,
      targets: [this],
      update: (p) => (this.pestle.alpha = 1 - p),
    });
    tweens.add({
      dur: 0.5,
      targets: [this, flask],
      update: (p) => {
        const e = ease.inOutSine(p);
        this.position.set(lerp(from.x, to.x, e), lerp(from.y, to.y, e));
        this.bowl.rotation = tilt * e;
      },
      done: () => {
        this.audio.play('herbs.pour', { volume: 0.9 });
        const lip = () => this.bowl.toGlobal(new Point(OPEN_RX + 12, OPEN_Y - 6));
        const mouth = () => flask.mouthGlobal();
        tweens.add({
          dur: 1.4,
          targets: [this, flask, stream],
          update: (p) => {
            const head = Math.min(1, p / 0.18);
            const tail = Math.max(0, (p - 0.82) / 0.18);
            drawStream(stream, layer.toLocal(lip()), layer.toLocal(mouth()), tail, head);
            flask.setLevel(ease.outCubic(Math.max(0, (p - 0.1) / 0.85)));
          },
          done: () => {
            stream.destroy();
            tweens.add({
              dur: 0.45,
              targets: [this, flask],
              update: (p) => {
                const e = ease.inOutSine(p);
                this.position.set(lerp(to.x, from.x, e), lerp(to.y, from.y, e));
                this.bowl.rotation = tilt * (1 - e);
              },
              done,
            });
          },
        });
      },
    });
  }

  private grab(e: FederatedPointerEvent): void {
    if (this.finished) return;
    this.dragging = e.pointerId;
    this.lastAngle = this.angleAt(e);
    this.cursor = 'grabbing';
  }

  private drag(e: FederatedPointerEvent): void {
    if (this.finished || this.dragging !== e.pointerId) return;
    const a = this.angleAt(e);
    if (a === null) {
      this.lastAngle = null;
      return;
    }
    if (this.lastAngle !== null) {
      let delta = a - this.lastAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      if (delta !== 0) this.turn(delta, a);
    }
    this.lastAngle = a;
  }

  private drop(e: FederatedPointerEvent): void {
    if (this.dragging !== e.pointerId) return;
    this.dragging = null;
    this.lastAngle = null;
    this.cursor = 'grab';
  }

  private turn(delta: number, angle: number): void {
    if (!this.started) {
      this.started = true;
      this.guide.visible = false;
    }
    this.progress = grindProgress(delta, this.progress);
    this.pestleAngle = angle;
    this.quiet = 0;
    if (!this.grinding) {
      this.grinding = true;
      this.audio.play('herbs.grind', { loop: true, volume: 0.8 });
    }
    this.placePestle();
    this.mash();
    this.drawRing();
    if (this.progress >= 1) {
      this.finished = true;
      this.silence();
      this.dragging = null;
      this.cursor = 'default';
      this.onGround?.(this.elapsed);
    }
  }

  /** Angle of the pointer round the ring centre, or null inside the dead zone. */
  private angleAt(e: FederatedPointerEvent): number | null {
    const p = this.toLocal(e.global);
    const dx = p.x;
    const dy = p.y - RING_Y;
    return Math.hypot(dx, dy) < DEAD_R ? null : Math.atan2(dy, dx);
  }

  /** The head circles the bowl floor and the handle leans the same way, like a hand grinding. */
  private placePestle(): void {
    const c = Math.cos(this.pestleAngle);
    const s = Math.sin(this.pestleAngle);
    this.pestle.position.set(c * OPEN_RX * 0.45, OPEN_Y + 34 + s * OPEN_RY * 0.8);
    this.pestle.rotation = c * 0.38;
  }

  /** Herbs shrink, spin and sink as the paste thickens. */
  private mash(): void {
    const p = this.progress;
    this.herbSprites.forEach(({ s, base }, i) => {
      s.scale.set(base * Math.max(0.05, 1 - p * 0.95));
      s.rotation += (i % 2 ? 1 : -1) * 0.02;
      s.alpha = 1 - Math.max(0, p - 0.7) / 0.3;
    });
    this.paste
      .clear()
      .ellipse(0, OPEN_Y + 4, OPEN_RX * 0.92, OPEN_RY * 0.9)
      .fill({ color: PASTE, alpha: Math.min(1, p * 1.4) });
  }

  private drawRing(): void {
    const g = this.ring.clear();
    g.circle(0, RING_Y, RING_R).stroke({ color: Theme.color.paper, alpha: 0.18, width: RING_W });
    if (this.progress > 0) {
      const start = -Math.PI / 2;
      g.moveTo(Math.cos(start) * RING_R, RING_Y + Math.sin(start) * RING_R)
        .arc(0, RING_Y, RING_R, start, start + this.progress * Math.PI * 2)
        .stroke({ color: LIQUID, width: RING_W, cap: 'round' });
    }
  }

  private drawGuide(): void {
    const trail = new Graphics();
    // dots behind the guide along the circle, in the guide's frame (it turns with its angle)
    for (let i = 1; i <= 6; i++) {
      const d = i * 0.16;
      trail
        .circle(GUIDE_R * (Math.cos(d) - 1), -GUIDE_R * Math.sin(d), 14 - i * 1.6)
        .fill({ color: Theme.color.paper, alpha: 0.5 - i * 0.07 });
    }
    const dot = new Graphics()
      .circle(0, 0, 26)
      .fill({ color: Theme.color.paper, alpha: 0.9 })
      .stroke({ color: Theme.color.ember, width: 5 });
    this.guide.addChild(trail, dot);
  }

  /** Everything of the bowl in front of the opening's front edge (texture px → local). */
  private frontShape(): Graphics {
    const pts: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const th = Math.PI - (i / 24) * Math.PI;
      pts.push(Math.cos(th) * OPEN_RX, OPEN_Y + Math.sin(th) * OPEN_RY);
    }
    const half = MORTAR_W / 2 + 20;
    pts.push(half, OPEN_Y, half, 400, -half, 400, -half, OPEN_Y);
    return new Graphics().poly(pts).fill(0xffffff);
  }
}

/** Quadratic arc from the lip to the flask mouth, drawn between `from` and `to` (0–1 along it). */
function drawStream(
  g: Graphics,
  a: { x: number; y: number },
  b: { x: number; y: number },
  from: number,
  to: number,
): void {
  g.clear();
  if (to <= from) return;
  const c = { x: lerp(a.x, b.x, 0.75), y: Math.min(a.y, b.y) - 60 };
  const at = (t: number) => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
  });
  const steps = 18;
  const p0 = at(from);
  g.moveTo(p0.x, p0.y);
  for (let i = 1; i <= steps; i++) {
    const p = at(lerp(from, to, i / steps));
    g.lineTo(p.x, p.y);
  }
  g.stroke({ color: LIQUID, width: 14, cap: 'round', join: 'round', alpha: 0.95 });
}

/** Neck top and the fill line, in texture px of glass/shape_flakon (210×468). */
const FLASK_TEX = { w: 210, h: 468, mouthY: 92, fillTop: 150, fillBottom: 452 };

/** Liquid inset from the glass outline (the violet walls stay visible round it). */
const WALL = { x: 0.8, y: 0.94, lift: 14 };

/**
 * Violet glass flask (anchor bottom centre) that fills with green remedy via setLevel(0–1): the
 * liquid sits inside the walls, under a thin violet glaze and a highlight, so it reads as glass.
 */
export class Flask extends Container {
  private readonly liquid = new Graphics();
  private readonly k: number;
  private level = 0;

  constructor(assets: AssetRegistry, height = 300) {
    super();
    this.k = height / FLASK_TEX.h;
    const glassSprite = () => {
      const s = fit(sprite(assets, 'glass/shape_flakon'), 1000, height);
      s.anchor.set(0.5, 1);
      return s;
    };
    const glass = glassSprite();
    glass.tint = FLASK_TINT;
    const inner = glassSprite();
    inner.scale.set(inner.scale.x * WALL.x, inner.scale.y * WALL.y);
    inner.y = -WALL.lift * this.k;
    this.liquid.mask = inner;
    const glaze = glassSprite();
    glaze.tint = FLASK_TINT;
    glaze.alpha = 0.3;
    const shine = new Graphics()
      .roundRect(-this.k * 70, -this.k * 380, this.k * 16, this.k * 200, this.k * 8)
      .fill({ color: 0xffffff, alpha: 0.3 });
    this.addChild(glass, this.liquid, inner, glaze, shine);
  }

  get filled(): number {
    return this.level;
  }

  setLevel(p: number): void {
    this.level = Math.max(0, Math.min(1, p));
    const { k } = this;
    const bottom = -(FLASK_TEX.h - FLASK_TEX.fillBottom) * k;
    const top = lerp(bottom, -(FLASK_TEX.h - FLASK_TEX.fillTop) * k, this.level);
    const w = FLASK_TEX.w * k;
    this.liquid.clear();
    if (this.level <= 0) return;
    // the inner mask trims the rect to the inside of the walls
    this.liquid
      .rect(-w / 2, top, w, -top)
      .fill({ color: LIQUID, alpha: 0.95 })
      .rect(-w / 2, top, w, 4 * k + 2)
      .fill({ color: 0xd8f0a8, alpha: 0.7 });
  }

  /** The flask neck in screen space, where the stream lands. */
  mouthGlobal(): Point {
    return this.toGlobal(new Point(0, -(FLASK_TEX.h - FLASK_TEX.mouthY) * this.k));
  }
}
