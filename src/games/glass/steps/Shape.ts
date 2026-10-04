import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { pick } from '../../../core/Rng';
import { Theme } from '../../../ui/Theme';
import { ease, softDotTexture } from '../fx';
import { LIMITS, SHAPES, mineralTint, type MineralId, type ShapeId } from '../rules';
import { LAYOUT, Tile, Vessel } from '../ui';
import { Step, type StepEnv } from './Step';

const SHAPE_H = 200;
/** Vessel height per px of bubble radius, clamped so a burst gather still makes a visible vessel. */
const VESSEL_PER_R = 1.1;
const VESSEL_MIN = 120;
const VESSEL_MAX = 330;
/** The mould is drawn 2.9 × the bubble radius, up to this radius. */
const MOLD_R_MAX = 280;

export function vesselHeight(r: number): number {
  return Math.min(VESSEL_MAX, Math.max(VESSEL_MIN, r * VESSEL_PER_R));
}

/**
 * Uformuj: five moulds (white glass shapes tinted with the chosen colour). A tap closes the wooden
 * mould around the bubble (two halves slide together, clack, squash, steam) and the finished vessel
 * pops up on the table. 15 s limit: no choice → a random wrong shape.
 */
export class ShapeStep extends Step {
  readonly kind = 'shape';
  private readonly tiles = new Map<ShapeId, Tile>();
  private readonly mold = new Container();
  /** Frames cut from glass/mold for the two halves; they share its source and are freed on unmount. */
  private readonly moldFrames: Texture[] = [];
  private chosen: ShapeId | null = null;

  constructor(
    env: StepEnv,
    private readonly mineral: MineralId,
    private readonly onDone: (shape: ShapeId, vessel: Vessel) => void,
  ) {
    super(env, LIMITS.shape);
  }

  protected start(): void {
    const { t, card, ctx } = this.env;
    card.set(t('glass.shape.h'), t('glass.shape.p'));
    const tint = mineralTint(this.mineral);
    this.addChild(this.mold);
    SHAPES.forEach((id, i) => {
      const view = new Vessel(ctx.assets, id, tint, SHAPE_H);
      const tile = new Tile({
        view,
        height: view.glass.height,
        width: view.glass.width,
        caption: t(`glass.shapes.${id}`),
        name: `glass.shape.${id}`,
        kiosk: ctx.kiosk,
      });
      tile.position.set(LAYOUT.rowX(i), LAYOUT.rowBottom - 40);
      tile.onPick = () => this.choose(id);
      tile.alpha = 0;
      this.tw.add(0.35, (p) => {
        tile.alpha = p;
        tile.y = LAYOUT.rowBottom - 40 + (1 - p) * 60;
      }, { delay: i * 0.06, ease: ease.outBack });
      this.tiles.set(id, tile);
      this.addChild(tile);
    });
  }

  override unmount(): void {
    super.unmount();
    // destroy(false): the halves are frames of the shared glass/mold texture source
    for (const t of this.moldFrames) t.destroy(false);
    this.moldFrames.length = 0;
  }

  protected override timeUp(): void {
    this.env.toast.show(this.env.t('glass.timeUp'));
    this.choose(pick(this.env.rng, SHAPES.filter((s) => s !== this.env.order.shape)));
  }

  protected override tick(dt: number): void {
    for (const tile of this.tiles.values()) tile.update(dt);
  }

  private choose(id: ShapeId): void {
    if (this.chosen !== null) return;
    this.chosen = id;
    this.stopClock();
    for (const [sid, tile] of this.tiles) tile.settle(sid === id);
    this.env.ctx.audio.play('ui.tap');
    this.closeMold(id);
  }

  private closeMold(id: ShapeId): void {
    const { piece, ctx, fx, table, index } = this.env;
    const c = piece.bubbleCentre();
    const r = piece.r;
    const [left, right] = this.moldHalves(r);
    this.mold.addChild(left, right);
    // the halves meet over the bubble and shut on top of each other
    const gap = r * 1.2 + left.width;
    const seam = left.width * 0.03;
    const slide = (p: number) => {
      left.position.set(c.x - seam - gap * (1 - p), c.y);
      right.position.set(c.x + seam + gap * (1 - p), c.y);
      left.alpha = right.alpha = Math.min(1, p * 2.5);
    };
    slide(0);
    this.tw.add(0.42, slide, { ease: ease.inQuad });

    // clack: sound, squash, a shudder and steam
    this.tw.wait(0.42, () => {
      ctx.audio.play('glass.mold');
      this.steam(c.x, c.y - r * 1.1, r);
    });
    this.tw.add(0.5, (p) => piece.squash(1 - 0.25 * Math.sin(p * Math.PI), 1 + 0.14 * Math.sin(p * Math.PI)), {
      delay: 0.36,
      ease: ease.outCubic,
    });
    this.tw.add(0.22, (p) => (this.mold.x = Math.sin(p * Math.PI * 5) * 7 * (1 - p)), { delay: 0.42, ease: ease.linear });

    // the mould and the glass leave the bench, the pipe goes back for the next gather
    this.tw.add(0.3, (p) => {
      this.mold.alpha = 1 - p;
      piece.bubbleAlpha = 1 - p;
    }, { delay: 1.0 });
    const pipeX = piece.x;
    this.tw.add(0.5, (p) => (piece.x = pipeX - 260 * p), { delay: 1.05, ease: ease.inOutSine });

    // the vessel lands on the table: scale 0 → 1, easeOutBack
    const vessel = new Vessel(ctx.assets, id, mineralTint(this.mineral), vesselHeight(r));
    const slot = LAYOUT.tableSlots[Math.min(index, LAYOUT.tableSlots.length - 1)];
    vessel.position.set(slot, LAYOUT.tableY);
    vessel.scale.set(0);
    this.tw.wait(1.15, () => {
      table.addChild(vessel);
      this.sparkle(fx, slot, LAYOUT.tableY - vessel.glass.height / 2);
      ctx.audio.play('ui.star', { volume: 0.6 });
    });
    this.tw.add(0.55, (p) => vessel.scale.set(Math.max(0, p)), { delay: 1.15, ease: ease.outBack });
    this.tw.wait(2.0, () => {
      piece.bubbleVisible = false;
      this.onDone(id, vessel);
    });
  }

  /** Left and right halves of glass/mold (or two wooden blocks when it is missing), centre-anchored. */
  private moldHalves(r: number): [Container, Container] {
    const assets = this.env.ctx.assets;
    // a bubble blown well past the ring (up to 150 %) must not get a mould taller than the screen
    const h = Math.min(r, MOLD_R_MAX) * 2.9;
    if (!assets.has('glass/mold')) {
      const block = () =>
        new Graphics().roundRect(-h * 0.35, -h / 2, h * 0.7, h, 18).fill(0x6b4a2c).stroke({ color: 0x2a1a0c, width: 6 });
      return [block(), block()];
    }
    const tex = assets.texture('glass/mold');
    const f = tex.frame;
    const half = (side: 0 | 1) => {
      const t = new Texture({ source: tex.source, frame: new Rectangle(f.x + (side * f.width) / 2, f.y, f.width / 2, f.height) });
      this.moldFrames.push(t);
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.scale.set(h / f.height);
      return s;
    };
    return [half(0), half(1)];
  }

  private steam(x: number, y: number, r: number): void {
    for (let i = 0; i < 16; i++) {
      const puff = new Sprite(softDotTexture());
      puff.anchor.set(0.5);
      puff.tint = 0xf6ead6;
      puff.alpha = 0.55;
      puff.scale.set((40 + Math.random() * 40) / 128);
      puff.position.set(x + (Math.random() - 0.5) * r * 1.6, y + Math.random() * 30);
      this.env.fx.spawn(puff, {
        vx: (Math.random() - 0.5) * 60,
        vy: -80 - Math.random() * 90,
        life: 1.1 + Math.random() * 0.5,
        endScale: 2.6,
        sway: 25,
        delay: Math.random() * 0.15,
      });
    }
  }

  private sparkle(fx: StepEnv['fx'], x: number, y: number): void {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const star = new Graphics().star(0, 0, 4, 14, 4).fill(Theme.color.star);
      star.position.set(x, y);
      fx.spawn(star, { vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, drag: 0.08, spin: 5, life: 0.75, endScale: 0.2 });
    }
  }
}
