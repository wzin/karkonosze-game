import { Rectangle, Text } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { Button } from '../../../ui/Button';
import { FactCard } from '../../../ui/FactCard';
import { SpeechBubble } from '../../../ui/SpeechBubble';
import { Stars } from '../../../ui/Stars';
import { Theme } from '../../../ui/Theme';
import { ease, mixColor } from '../fx';
import { mineralTint, noteKeys, orderScore, reactionKey, starsFor, type Made } from '../rules';
import { LAYOUT, type Vessel } from '../ui';
import { Step, type StepEnv } from './Step';

const LEFT = 40;
const COL_W = 1060;
/** Text column right of the portrait in a SpeechBubble (portrait box 166 + tail 26). */
const TEXT_X = LEFT + 192;

/**
 * The customer's verdict: reaction in a speech bubble with their portrait, 1–3 stars, notes on what
 * was off, a "did you know" fact and the next / finish button. The new vessel glows on the table.
 */
export class ResultStep extends Step {
  readonly kind = 'result';
  readonly stars: 1 | 2 | 3;
  private glow: GlowFilter | null = null;
  private age = 0;

  constructor(
    env: StepEnv,
    private readonly made: Made,
    private readonly vessel: Vessel,
    private readonly last: boolean,
    private readonly onNext: () => void,
  ) {
    super(env, null);
    const { order } = env;
    this.stars = starsFor(
      orderScore({ heat: made.heat, blow: made.blow, mineralOk: made.mineral === order.mineral, shapeOk: made.shape === order.shape }),
    );
  }

  protected start(): void {
    const { t, ctx, order, index } = this.env;
    this.env.card.visible = false;
    const id = order.id;

    const bubble = new SpeechBubble({
      portrait: ctx.assets.texture(`glass/portrait_${id}`),
      name: t(`glass.customers.${id}.name`),
      text: t(`glass.customers.${id}.${reactionKey(this.stars)}`),
      width: COL_W,
    });
    bubble.position.set(LEFT, LAYOUT.order.y);

    const stars = new Stars(3, 92);
    stars.position.set(TEXT_X, bubble.y + bubble.height + 22);
    stars.onStar = () => ctx.audio.play('ui.star');

    const lines = noteKeys(order, this.made).map((key) => {
      if (key === 'color')
        return t('glass.notes.color', {
          want: t(`glass.minerals.${order.mineral}.name`),
          got: t(`glass.minerals.${this.made.mineral}.name`),
        });
      if (key === 'shape')
        return t('glass.notes.shape', {
          want: t(`glass.shapes.${order.shape}`).toLocaleLowerCase('pl'),
          got: t(`glass.shapes.${this.made.shape}`).toLocaleLowerCase('pl'),
        });
      return t(`glass.notes.${key}`);
    });
    const style = Theme.text.body(28, Theme.color.emberSoft);
    style.wordWrapWidth = COL_W - (TEXT_X - LEFT);
    const notes = new Text({ text: lines.join(' '), style });
    notes.position.set(TEXT_X, stars.y + 92 + 18);
    notes.visible = lines.length > 0;

    const factY = (notes.visible ? notes.y + notes.height : stars.y + 92) + 26;
    const facts = ctx.i18n.get<string[]>('glass.facts') ?? [];
    const fact = new FactCard(t('ui.didYouKnow'), facts[index % Math.max(facts.length, 1)] ?? '', COL_W);
    fact.position.set(LEFT, factY);

    const button = new Button(t(this.last ? 'glass.finish' : 'glass.next'), {
      kiosk: ctx.kiosk,
      layout: ctx.layout,
      name: 'glass.next',
      onTap: () => ctx.audio.play('ui.tap'),
      onPress: () => {
        button.enabled = false;
        this.onNext();
      },
    });
    button.position.set(LEFT, Math.min(fact.y + fact.height + 28, 1080 - 24 - button.box.h - 6));

    this.addChild(bubble, stars, notes, fact, button);

    // entrance: the bubble slides in, the rest fades up after it
    bubble.x = -COL_W;
    this.tw.add(0.5, (p) => (bubble.x = -COL_W + (LEFT + COL_W) * p), { ease: ease.outBack });
    for (const [i, view] of [notes, fact, button].entries()) {
      const y = view.y;
      view.alpha = 0;
      this.tw.add(0.4, (p) => {
        view.alpha = p;
        view.y = y + (1 - p) * 30;
      }, { delay: 0.35 + i * 0.12 });
    }
    // Stars.set re-pops lit stars, so it is called exactly once per result
    this.tw.wait(0.35, () => stars.set(this.stars));
    ctx.audio.play(this.stars === 1 ? 'ui.fail' : 'ui.success', { volume: 0.7 });

    this.glowVessel();
  }

  override debug(): Record<string, number | string> {
    return { stars: this.stars };
  }

  protected override tick(dt: number): void {
    this.age += dt;
    if (this.glow) this.glow.outerStrength = 3.4 + Math.sin(this.age * 3) * 1.2;
  }

  override unmount(): void {
    // the vessel keeps a calm glow on the table; only the pulse stops
    if (this.glow) this.glow.outerStrength = 2.6;
    super.unmount();
  }

  /** GlowFilter in the glass colour, limited to the vessel's own box (see glowFilterArea). */
  private glowVessel(): void {
    this.vessel.lit = true;
    this.glow = addVesselGlow(this.vessel, mineralTint(this.made.mineral));
  }
}

const GLOW_DISTANCE = 16;

/**
 * A GlowFilter in the glass colour on the vessel's glass. The filter area is pinned to the glass's
 * own box plus the glow distance: a full-design-rect area would run the glow's ~190 samples per
 * pixel over the whole screen for a 250 px vessel.
 */
export function addVesselGlow(vessel: Vessel, tint: number): GlowFilter {
  const glow = new GlowFilter({
    distance: GLOW_DISTANCE,
    outerStrength: 3.4,
    innerStrength: 0.4,
    color: mixColor(tint, 0xffffff, 0.3),
    quality: 0.12,
  });
  const glass = vessel.glass;
  // local bounds: the glass's own box, independent of the holder's (pop-in) scale
  const b = glass.getLocalBounds();
  const pad = GLOW_DISTANCE + 6;
  glass.filterArea = new Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2);
  glass.filters = [glow];
  return glow;
}
