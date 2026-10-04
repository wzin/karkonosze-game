import { Container, Graphics, Text } from 'pixi.js';
import { Theme } from './Theme';

const R = 44;

/** Spinning ember arc with a label and ticking dots, centred on (0, 0). Call update(dt) every frame. */
export class Loader extends Container {
  private readonly spinner = new Graphics();
  private readonly dots: Text;
  private t = 0;

  constructor(label: string) {
    super();
    const track = new Graphics().circle(0, 0, R).stroke({ color: Theme.color.paper, alpha: 0.15, width: 10 });
    this.spinner.arc(0, 0, R, 0, Math.PI * 1.3).stroke({ color: Theme.color.ember, width: 10, cap: 'round' });

    const style = { fontFamily: Theme.font.body, fontWeight: '700', fontSize: 30, fill: Theme.color.paper } as const;
    const text = new Text({ text: label, style });
    text.anchor.set(0.5, 0);
    text.position.set(0, R + 28);
    // the dots live in their own Text so the label does not shift as they change
    this.dots = new Text({ text: '', style });
    this.dots.position.set(text.width / 2, text.y);

    this.addChild(track, this.spinner, text, this.dots);
  }

  update(dt: number): void {
    this.t += dt;
    this.spinner.rotation = this.t * 5;
    this.dots.text = '.'.repeat(Math.floor(this.t * 2.5) % 4);
  }
}
