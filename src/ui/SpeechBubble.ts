import { Container, Graphics, Text, type Texture } from 'pixi.js';
import { Portrait } from './Portrait';
import { Theme } from './Theme';

const PORTRAIT = 150;
/** Portrait ring plus breathing room. */
const PORTRAIT_BOX = PORTRAIT + 16;
const TAIL = 26;
const PAD = 28;

/**
 * A character speaking: round portrait on the left, paper bubble with the name and the line on the
 * right. Laid out from its top-left corner; the height follows the text.
 */
export class SpeechBubble extends Container {
  private readonly bubble = new Graphics();
  private readonly nameText: Text;
  private readonly body: Text;
  private readonly bubbleX = PORTRAIT_BOX + TAIL;
  private readonly bubbleW: number;

  constructor(opts: { portrait: Texture; name: string; text: string; width?: number }) {
    super();
    const width = opts.width ?? 1100;
    this.bubbleW = width - this.bubbleX;

    const portrait = new Portrait(opts.portrait, PORTRAIT);
    portrait.position.set(PORTRAIT_BOX / 2, PORTRAIT_BOX / 2);

    this.nameText = new Text({
      text: opts.name,
      style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 30, fill: Theme.color.dusk },
    });
    this.nameText.position.set(this.bubbleX + PAD, PAD - 6);

    const style = Theme.text.body(28, Theme.color.ink);
    style.wordWrapWidth = this.bubbleW - PAD * 2;
    this.body = new Text({ text: opts.text, style });
    this.body.position.set(this.bubbleX + PAD, PAD + this.nameText.height + 2);

    this.addChild(this.bubble, portrait, this.nameText, this.body);
    this.drawBubble();
  }

  setText(t: string): void {
    this.body.text = t;
    this.drawBubble();
  }

  private drawBubble(): void {
    const x = this.bubbleX;
    const w = this.bubbleW;
    const h = Math.max(PORTRAIT_BOX, this.body.y + this.body.height + PAD);
    const tailY = PORTRAIT_BOX / 2;
    const tail = [x + 2, tailY - 20, x - TAIL + 4, tailY + 2, x + 2, tailY + 22];
    this.bubble
      .clear()
      .roundRect(x, 6, w, h, 26)
      .fill({ color: Theme.color.night, alpha: 0.35 })
      .roundRect(x, 0, w, h, 26)
      .fill(Theme.color.paper)
      .stroke({ color: Theme.color.ink, alpha: 0.15, width: 2 })
      .poly(tail)
      .fill(Theme.color.paper);
  }
}
