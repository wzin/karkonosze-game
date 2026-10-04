import { Container, Graphics, Text } from 'pixi.js';
import { sprite, type AssetRegistry } from '../../core/Assets';
import type { I18n } from '../../core/I18n';
import { Theme } from '../../ui/Theme';
import { ease, type Tweens } from './anim';
import { fit, panel, tickBadge } from './parts';
import type { PlantId, Recipe } from './rules';

export const PANEL = { w: 1040, h: 190 };
const ICON = 90;
const SLOT_W = 260;
const ICON_Y = 108;
const BAR = { inset: 28, y: PANEL.h - 24, h: 10 };

/**
 * The recipe card under the TopBar: the recipe line, one 90 px miniature per herb with its name and
 * a tick once it is in the basket, and the time left as a shrinking bar. Top-left origin.
 */
export class RecipePanel extends Container {
  private readonly line: Text;
  private readonly slots = new Container();
  private readonly bar = new Graphics();
  private readonly ticks = new Map<PlantId, Graphics>();

  constructor(
    private readonly assets: AssetRegistry,
    private readonly i18n: I18n,
    private readonly tweens: Tweens,
  ) {
    super();
    const style = Theme.text.body(28);
    style.fontWeight = '700';
    style.wordWrapWidth = PANEL.w - 60;
    style.align = 'center';
    this.line = new Text({ text: '', style });
    this.line.anchor.set(0.5, 0);
    this.line.position.set(PANEL.w / 2, 16);
    this.addChild(panel(PANEL.w, PANEL.h), this.line, this.slots, this.bar);
  }

  show(recipe: Recipe): void {
    this.line.text = this.i18n.t(`herbs.recipes.${recipe.id}.line`);
    this.slots.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.ticks.clear();
    const x0 = PANEL.w / 2 - ((recipe.herbs.length - 1) * SLOT_W) / 2;
    recipe.herbs.forEach((id, i) => {
      const slot = new Container();
      slot.position.set(x0 + i * SLOT_W, ICON_Y);
      const disc = new Graphics().circle(0, 0, ICON / 2 + 6).fill({ color: Theme.color.paper, alpha: 0.14 });
      const icon = fit(sprite(this.assets, `herbs/plant_${id}`, { w: 200, h: 240, tint: 0x6d9a52 }), ICON, ICON);
      icon.anchor.set(0.5);
      const name = new Text({
        text: this.i18n.t(`herbs.plants.${id}`),
        style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 22, fill: Theme.color.emberSoft },
      });
      name.anchor.set(0, 0.5);
      // the name sits right of the icon so the panel stays short
      icon.position.set(-60, -8);
      disc.position.copyFrom(icon.position);
      name.position.set(icon.x + ICON / 2 + 8, -8);
      const tick = tickBadge(18);
      tick.position.set(icon.x + 32, icon.y + 30);
      tick.visible = false;
      this.ticks.set(id, tick);
      slot.addChild(disc, icon, name, tick);
      this.slots.addChild(slot);
    });
    this.setTime(1);
    this.alpha = 0;
    this.tweens.add({ dur: 0.35, update: (p) => (this.alpha = p) });
  }

  tick(id: PlantId): void {
    const tick = this.ticks.get(id);
    if (!tick || tick.visible) return;
    tick.visible = true;
    this.tweens.add({ dur: 0.4, update: (p) => tick.scale.set(ease.outBack(p)) });
  }

  /** `left` = share of the gathering time still left (1 → 0). */
  setTime(left: number): void {
    const w = PANEL.w - BAR.inset * 2;
    const k = Math.max(0, Math.min(1, left));
    const color = k < 0.25 ? Theme.color.bad : Theme.color.ember;
    this.bar
      .clear()
      .roundRect(BAR.inset, BAR.y, w, BAR.h, BAR.h / 2)
      .fill({ color: Theme.color.paper, alpha: 0.15 });
    if (k > 0) this.bar.roundRect(BAR.inset, BAR.y, Math.max(BAR.h, w * k), BAR.h, BAR.h / 2).fill(color);
  }
}
