import { Container, Graphics } from 'pixi.js';
import { Theme } from './Theme';

const H = 18;
const GAP = 12;

/** One pill per round: finished ones ember, the current one outlined, the rest dim. Top-left origin. */
export class RoundProgress extends Container {
  private readonly bar = new Graphics();
  private readonly total: number;
  private done = 0;

  constructor(
    total: number,
    private readonly barWidth = 600,
  ) {
    super();
    this.total = Math.max(1, Math.round(total));
    this.addChild(this.bar);
    this.draw();
  }

  set(done: number): void {
    this.done = Math.max(0, Math.min(this.total, Math.round(done)));
    this.draw();
  }

  private draw(): void {
    const seg = (this.barWidth - GAP * (this.total - 1)) / this.total;
    this.bar.clear();
    for (let i = 0; i < this.total; i++) {
      this.bar.roundRect(i * (seg + GAP), 0, seg, H, H / 2);
      if (i < this.done) this.bar.fill(Theme.color.ember);
      else if (i === this.done)
        this.bar
          .fill({ color: Theme.color.emberSoft, alpha: 0.3 })
          .stroke({ color: Theme.color.ember, width: 3, alpha: 0.95 });
      else this.bar.fill({ color: Theme.color.paper, alpha: 0.2 });
    }
  }
}
