import { Container, Graphics, type Sprite, type Texture } from 'pixi.js';
import { sprite, type AssetRegistry } from '../../core/Assets';

export interface Point {
  x: number;
  y: number;
}

/**
 * Emma's escape down the stone path of `turnips/bg`: from the chapel door on the summit to the foot
 * of the path, one point per round. After the last round she runs off the left edge, into the valley.
 */
export const EMMA_PATH: readonly Point[] = [
  { x: 582, y: 468 },
  { x: 620, y: 522 },
  { x: 598, y: 580 },
  { x: 628, y: 642 },
  { x: 645, y: 694 },
  { x: 590, y: 736 },
];
export const EMMA_EXIT: Point = { x: -110, y: 732 };

/** Seconds per run frame. */
const FRAME_S = 0.15;
const SIZE = { w: 505, h: 691 };

/** Smaller by the chapel, bigger at the foot of the path (perspective). */
export function emmaScale(y: number): number {
  const top = EMMA_PATH[0].y;
  const foot = EMMA_PATH[EMMA_PATH.length - 1].y;
  return 0.075 + (0.095 * (y - top)) / (foot - top);
}

/** The princess, feet at (0, 0): two run frames swapped every 0.15 s while she runs, a soft shadow. */
export class Emma extends Container {
  private readonly body: Sprite;
  private readonly frames: Texture[];
  private facing = 1;
  private running = false;
  private frameTime = 0;
  private frame = 0;
  private runTime = 0;

  constructor(assets: AssetRegistry) {
    super();
    const shadow = new Graphics().ellipse(0, 0, 170, 34).fill({ color: 0x0b1210, alpha: 0.32 });
    this.body = sprite(assets, 'turnips/emma_1', { ...SIZE, tint: 0x6a86b8 });
    this.body.anchor.set(0.5, 0.97);
    this.frames = ['turnips/emma_1', 'turnips/emma_2'].filter((a) => assets.has(a)).map((a) => assets.texture(a));
    this.addChild(shadow, this.body);
  }

  /** Stands her at `p` with the perspective scale; keeps the way she faces. */
  place(p: Point): void {
    this.position.set(p.x, p.y);
    const s = emmaScale(p.y);
    this.scale.set(s * this.facing, s);
  }

  /** The sprite runs to the right; -1 mirrors her. */
  face(dir: 1 | -1): void {
    this.facing = dir;
    this.scale.x = Math.abs(this.scale.x) * dir;
  }

  get isRunning(): boolean {
    return this.running;
  }

  set isRunning(on: boolean) {
    this.running = on;
    if (!on) {
      this.body.y = 0;
      this.showFrame(0);
    }
  }

  update(dt: number): void {
    if (!this.running) return;
    this.runTime += dt;
    this.frameTime += dt;
    if (this.frameTime >= FRAME_S) {
      this.frameTime -= FRAME_S;
      this.showFrame(1 - this.frame);
    }
    // a little bounce in every stride
    this.body.y = -Math.abs(Math.sin((this.runTime * Math.PI) / FRAME_S)) * 28;
  }

  private showFrame(i: number): void {
    this.frame = i;
    if (this.frames.length === 2) this.body.texture = this.frames[i];
  }
}
