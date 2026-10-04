import { Container, Graphics, Text } from 'pixi.js';
import { Theme } from './Theme';

const PAD = 32;

/** "Did you know" card: a sparkle, the label and a wrapped fact; top-left origin, height follows the text. */
export class FactCard extends Container {
  constructor(label: string, text: string, width = 900) {
    super();
    const sparkle = new Graphics()
      .star(0, 0, 4, 16, 5)
      .fill(Theme.color.star)
      .circle(0, 0, 4)
      .fill(Theme.color.emberSoft);
    sparkle.position.set(PAD + 14, PAD + 20);

    const title = new Text({
      text: label,
      style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 32, fill: Theme.color.ember },
    });
    title.position.set(PAD + 42, PAD);

    const style = Theme.text.body(28);
    style.wordWrapWidth = width - PAD * 2;
    const body = new Text({ text, style });
    body.position.set(PAD, PAD + title.height + 12);

    const h = body.y + body.height + PAD;
    const card = new Graphics()
      .roundRect(0, 6, width, h, 24)
      .fill({ color: Theme.color.night, alpha: 0.4 })
      .roundRect(0, 0, width, h, 24)
      .fill({ color: Theme.color.night, alpha: 0.9 })
      .stroke({ color: Theme.color.ember, alpha: 0.6, width: 2 });

    this.addChild(card, sparkle, title, body);
  }
}
