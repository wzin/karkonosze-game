import { Container, Graphics, Ticker, type DestroyOptions } from 'pixi.js';
import { Theme } from './Theme';

/** Seconds between two stars popping in, and the length of one pop. */
const STAGGER = 0.32;
const POP = 0.45;
const STAR_EDGE = 0xc98a1e;

/**
 * A row of `max` stars, the first `n` lit, laid out from its top-left corner. set(n) pops the lit
 * stars in one after another (onStar fires as each lands; scenes play `ui.star` there).
 */
export class Stars extends Container {
  onStar?: (index: number) => void;
  private readonly lit: Graphics[] = [];
  private target = 0;
  private elapsed = 0;
  private fired = 0;
  private animating = false;

  constructor(
    private readonly max = 3,
    size = 56,
  ) {
    super();
    const r = size / 2;
    for (let i = 0; i < max; i++) {
      const slot = new Container();
      slot.position.set(i * size * 1.2 + r, r);
      const empty = new Graphics()
        .star(0, 0, 5, r, r * 0.46)
        .fill({ color: Theme.color.paper, alpha: 0.16 })
        .stroke({ color: Theme.color.paper, alpha: 0.5, width: 3, join: 'round' });
      const full = new Graphics()
        .star(0, 0, 5, r, r * 0.46)
        .fill(Theme.color.star)
        .stroke({ color: STAR_EDGE, width: 3, join: 'round' });
      full.visible = false;
      slot.addChild(empty, full);
      this.addChild(slot);
      this.lit.push(full);
    }
  }

  set(n: number, animate = true): void {
    this.stop();
    this.target = Math.max(0, Math.min(this.max, Math.round(n)));
    this.lit.forEach((star, i) => {
      star.visible = !animate && i < this.target;
      star.scale.set(1);
      star.rotation = 0;
    });
    if (!animate || this.target === 0) return;
    this.elapsed = 0;
    this.fired = 0;
    this.animating = true;
    Ticker.shared.add(this.tick, this);
  }

  override destroy(options?: DestroyOptions): void {
    this.stop();
    super.destroy(options);
  }

  private tick(ticker: Ticker): void {
    this.elapsed += Math.min(ticker.deltaMS / 1000, 0.1);
    for (let i = 0; i < this.target; i++) {
      const p = (this.elapsed - i * STAGGER) / POP;
      if (p <= 0) continue;
      const star = this.lit[i];
      star.visible = true;
      star.scale.set(backOut(Math.min(p, 1)));
      star.rotation = (1 - Math.min(p, 1)) * 0.6;
      if (i >= this.fired) {
        this.fired = i + 1;
        this.onStar?.(i);
      }
    }
    if (this.elapsed >= (this.target - 1) * STAGGER + POP) this.stop();
  }

  private stop(): void {
    if (!this.animating) return;
    this.animating = false;
    Ticker.shared.remove(this.tick, this);
    // finish the pop instantly
    this.lit.forEach((star, i) => {
      if (i < this.target) {
        star.visible = true;
        star.scale.set(1);
        star.rotation = 0;
      }
    });
  }
}

/** Overshoots past 1 and settles back: a springy pop. */
function backOut(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}
