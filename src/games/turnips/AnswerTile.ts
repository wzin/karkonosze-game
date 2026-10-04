import { Graphics, Text } from 'pixi.js';
import { Button, type ButtonOpts } from '../../ui/Button';
import { Theme } from '../../ui/Theme';

export const TILE = { w: 200, h: 120 };
const RADIUS = 28;
const LIP = 6;
const MARKS = {
  right: { fill: Theme.color.glass, lip: 0x1b5e48 },
  wrong: { fill: Theme.color.bad, lip: 0x82203a },
};

/**
 * One answer: a 200×120 Button with its number in Fraunces 64. After the answer it is locked (no more
 * presses, no dimming) and marked green (right) or red (wrong); the others fade back.
 */
export class AnswerTile extends Button {
  readonly value: number;
  private readonly number: Text;
  private readonly shade = new Graphics();

  constructor(value: number, opts: Omit<ButtonOpts, 'icon' | 'width' | 'height'>) {
    const number = new Text({
      text: String(value),
      style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 64, fill: Theme.color.ink },
    });
    number.anchor.set(0.5, 0.52);
    super('', { ...opts, icon: number, width: TILE.w, height: TILE.h });
    this.value = value;
    this.number = number;
    // over the button's own background, under the number
    this.face.addChildAt(this.shade, 1);
  }

  lock(): void {
    this.eventMode = 'none';
    this.cursor = 'default';
    this.release();
  }

  mark(state: 'right' | 'wrong' | 'faded'): void {
    if (state === 'faded') {
      this.alpha = 0.4;
      return;
    }
    const m = MARKS[state];
    const { w, h } = TILE;
    this.shade
      .clear()
      .roundRect(-w / 2, -h / 2 + LIP, w, h, RADIUS)
      .fill(m.lip)
      .roundRect(-w / 2, -h / 2, w, h, RADIUS)
      .fill(m.fill)
      .stroke({ color: Theme.color.paper, width: 4, alpha: 0.9 });
    this.number.style.fill = Theme.color.paper;
  }
}
