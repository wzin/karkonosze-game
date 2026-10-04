import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import { DESIGN } from '../core/Layout';
import { Button } from '../ui/Button';
import { Theme } from '../ui/Theme';
import type { Place } from './Markers';
import { sentenceCase } from './rules';

export interface ConceptCardOpts {
  /** The "coming soon" chip (`ui.soon`). */
  soon: string;
  kiosk: boolean;
  onClose: () => void;
  /** Every pointerdown on the close button; the scene plays `ui.tap` here. */
  onTap?: () => void;
}

const W = 1100;
const H = 520;
const PAD = 52;
const RADIUS = 30;
const CLOSE = 72;
const BODY_MAX = 30;
const BODY_MIN = 20;
/** Seconds to fade in or out. */
const FADE = 0.2;
const MECH_INDENT = 46;
const INK_SOFT = 0x44535a;
const CHIP_TEXT = 0x9a5717;

/**
 * Card of a place whose game is not made yet, centred over a dimmed panorama: name, title, legend,
 * the planned game and a "coming soon" chip. The close button or a tap beside the card closes it.
 */
export class ConceptCard extends Container {
  private readonly panel = new Container();
  private shown = 0;
  private isClosing = false;

  constructor(place: Place, opts: ConceptCardOpts) {
    super();
    const backdrop = new Graphics().rect(0, 0, DESIGN.w, DESIGN.h).fill({ color: Theme.color.night, alpha: 0.6 });
    backdrop.eventMode = 'static';
    backdrop.cursor = 'pointer';
    backdrop.on('pointertap', opts.onClose);

    // the panel swallows taps, so only a tap beside it closes the card
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(-W / 2, -H / 2, W, H);
    this.panel.position.set(DESIGN.w / 2, DESIGN.h / 2);
    const left = -W / 2 + PAD;
    const top = -H / 2 + PAD - 8;

    const sheet = new Graphics()
      .roundRect(-W / 2, -H / 2 + 12, W, H, RADIUS)
      .fill({ color: Theme.color.night, alpha: 0.45 })
      .roundRect(-W / 2, -H / 2, W, H, RADIUS)
      .fill(Theme.color.paper)
      .stroke({ color: Theme.color.ember, alpha: 0.7, width: 3 })
      .roundRect(-W / 2 + 12, -H / 2 + 12, W - 24, H - 24, RADIUS - 10)
      .stroke({ color: Theme.color.ink, alpha: 0.12, width: 2 });

    const name = new Text({
      text: place.name,
      style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 24, fill: Theme.color.glass, letterSpacing: 0.5 },
    });
    name.position.set(left, top);

    const chip = soonChip(opts.soon);
    chip.position.set(left + name.width + 18, top - 2);

    const title = new Text({
      text: place.title,
      style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 50, fill: Theme.color.ink },
    });
    title.position.set(left, top + name.height + 4);
    const titleRoom = W - PAD * 2 - CLOSE;
    if (title.width > titleRoom) title.scale.set(titleRoom / title.width);

    const close = new Button('', {
      variant: 'quiet',
      height: CLOSE,
      icon: cross(),
      kiosk: opts.kiosk,
      onTap: opts.onTap,
      onPress: opts.onClose,
      name: 'hub.card.close',
    });
    close.position.set(W / 2 - 28 - close.box.w, -H / 2 + 28);

    const lore = new Text({ text: place.lore, style: bodyStyle(BODY_MAX, Theme.color.ink, W - PAD * 2) });
    const rule = new Graphics();
    const icon = playIcon();
    const mech = new Text({
      text: sentenceCase(place.mech),
      style: bodyStyle(BODY_MAX, INK_SOFT, W - PAD * 2 - MECH_INDENT),
    });

    // the card has a fixed size: long texts get a smaller font until they fit
    const bodyTop = title.y + title.height + 18;
    const bottom = H / 2 - PAD + 6;
    for (let size = BODY_MAX; size >= BODY_MIN; size--) {
      lore.style = bodyStyle(size, Theme.color.ink, W - PAD * 2);
      mech.style = bodyStyle(size, INK_SOFT, W - PAD * 2 - MECH_INDENT);
      lore.position.set(left, bodyTop);
      const ruleY = lore.y + lore.height + 18;
      mech.position.set(left + MECH_INDENT, ruleY + 18);
      rule.clear().moveTo(left, ruleY).lineTo(W / 2 - PAD, ruleY).stroke({ color: Theme.color.ember, alpha: 0.45, width: 2 });
      icon.position.set(left + 16, mech.y + size * 0.68);
      if (mech.y + mech.height <= bottom) break;
    }

    // a short text sits in the middle of the card rather than leaving its lower half empty
    const content = new Container();
    content.addChild(name, chip, title, lore, rule, icon, mech);
    content.y = Math.max(0, Math.round((bottom - (mech.y + mech.height)) / 2));
    this.panel.addChild(sheet, content, close);
    this.addChild(backdrop, this.panel);
    this.alpha = 0;
  }

  /** Starts fading the card out; the owner removes it once `closed`. Taps go through it meanwhile. */
  close(): void {
    this.isClosing = true;
    this.eventMode = 'none';
  }

  get closing(): boolean {
    return this.isClosing;
  }

  /** True when the card has faded out after close(). */
  get closed(): boolean {
    return this.isClosing && this.shown === 0;
  }

  /** Fades and settles the card in, or out after close(). */
  update(dt: number): void {
    const step = dt / FADE;
    this.shown = this.isClosing ? Math.max(this.shown - step, 0) : Math.min(this.shown + step, 1);
    const ease = 1 - (1 - this.shown) ** 3;
    this.alpha = ease;
    this.panel.scale.set(0.94 + 0.06 * ease);
  }
}

function bodyStyle(size: number, fill: number, wrap: number): TextStyle {
  const style = Theme.text.body(size, fill);
  style.wordWrapWidth = wrap;
  return style;
}

/** Ember pill with the "coming soon" text, drawn from its top-left corner. */
function soonChip(text: string): Container {
  const label = new Text({
    text,
    style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 22, fill: CHIP_TEXT },
  });
  const w = label.width + 32;
  const h = 36;
  label.anchor.set(0.5);
  label.position.set(w / 2, h / 2 + 1);
  const pill = new Graphics()
    .roundRect(0, 0, w, h, h / 2)
    .fill(Theme.color.emberSoft)
    .stroke({ color: Theme.color.ember, width: 2 });
  const chip = new Container();
  chip.addChild(pill, label);
  return chip;
}

/** The planned game: a small ember disc with a play triangle, centred on (0, 0). */
function playIcon(): Graphics {
  return new Graphics()
    .circle(0, 0, 16)
    .fill(Theme.color.ember)
    .poly([-5, -8, 9, 0, -5, 8])
    .fill(Theme.color.paper);
}

function cross(): Graphics {
  const s = 13;
  return new Graphics()
    .moveTo(-s, -s)
    .lineTo(s, s)
    .moveTo(s, -s)
    .lineTo(-s, s)
    .stroke({ color: Theme.color.paper, width: 5, cap: 'round' });
}
