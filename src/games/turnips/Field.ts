import { Container, Graphics, Sprite } from 'pixi.js';
import { sprite, type AssetRegistry } from '../../core/Assets';
import { FIELD } from './rules';

/** Sizes in slot-local px, i.e. on the front row; rows further back are scaled down. */
const MOUND = { w: 190, h: 53 };
const TURNIP = { w: 100, h: 170 };
const STONE = { w: 104, h: 88 };
/** The mound's hole sits at 65 % of its height: things come out of it. */
const HOLE_Y = 0.65;
/** How far below the cut line an item hides: turnip.y runs from +SUNK (hidden) to 0 (out). */
export const SUNK = 180;
const SOIL = [0x1a2325, 0x283234, 0x323c3c];

/** The back row of the furrows sits further away than the front row (perspective). */
export function rowScale(y: number): number {
  const t = (y - FIELD.back.y) / (FIELD.front.y - FIELD.back.y);
  return 0.92 + 0.2 * Math.min(Math.max(t, 0), 1);
}

/**
 * One mound on the field. A turnip or a stone rises out of its hole: the item is masked by a rect
 * that ends on the hole line, so whatever sinks below it disappears, and a soil lip hides the cut.
 */
export class FieldSlot extends Container {
  private readonly item = new Container();
  private readonly turnip: Sprite;
  private readonly stone: Sprite;
  private readonly cut = new Graphics().rect(-160, -420, 320, 420).fill(0xffffff);
  /** Loose soil over the cut line; only there while something is out, so the bare mound shows its hole. */
  private readonly lip = new Graphics()
    .ellipse(0, 4, 46, 11)
    .fill(SOIL[0])
    .ellipse(-17, 1, 20, 8)
    .fill(SOIL[1])
    .ellipse(15, 2, 18, 7)
    .fill(SOIL[2])
    .ellipse(1, -1, 12, 5)
    .fill(SOIL[1]);
  private readonly phase: number;
  private amount = 0;

  constructor(assets: AssetRegistry, x: number, y: number, phase: number) {
    super();
    this.position.set(x, y);
    this.scale.set(rowScale(y));
    this.phase = phase;

    const mound = fitted(assets, 'turnips/mound', MOUND, 0x2b3436);
    mound.anchor.set(0.5, HOLE_Y);
    this.turnip = fitted(assets, 'turnips/turnip', TURNIP, 0xe9dcf0);
    // the thin root tip stays in the ground: y = 0 puts the bulb's bottom on the cut line
    this.turnip.anchor.set(0.5, 0.86);
    this.stone = fitted(assets, 'turnips/stone', STONE, 0x9aa3ad);
    this.stone.anchor.set(0.5, 0.82);
    this.item.addChild(this.turnip, this.stone);
    this.item.mask = this.cut;

    this.addChild(mound, this.item, this.cut, this.lip);
    this.lift = 0;
  }

  /** Which thing comes out next. */
  hold(kind: 'turnip' | 'stone'): void {
    this.turnip.visible = kind === 'turnip';
    this.stone.visible = kind === 'stone';
  }

  /** 0 = hidden in the mound, 1 = all the way out; eased values may overshoot either end. */
  get lift(): number {
    return this.amount;
  }

  set lift(k: number) {
    this.amount = k;
    this.item.y = SUNK * (1 - k);
    this.item.visible = k > 0.001;
    this.lip.alpha = Math.min(Math.max(k * 4, 0), 1);
    if (k <= 0) this.item.rotation = 0;
  }

  /** Leaves sway while the item is out. `t` is the scene time in seconds. */
  sway(t: number): void {
    if (this.amount > 0.6) this.item.rotation = Math.sin(t * 5 + this.phase) * 0.05;
  }

  /** The hole in design px, for the dirt spray. */
  get hole(): { x: number; y: number; scale: number } {
    return { x: this.x, y: this.y, scale: this.scale.x };
  }
}

/** A sprite fitted into `box`; a missing texture becomes a tinted placeholder of that size. */
export function fitted(assets: AssetRegistry, alias: string, box: { w: number; h: number }, tint: number): Sprite {
  const s = sprite(assets, alias, { w: box.w, h: box.h, tint });
  if (assets.has(alias)) s.scale.set(Math.min(box.w / s.texture.width, box.h / s.texture.height));
  return s;
}
