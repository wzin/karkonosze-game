import { Container, Graphics, Text } from 'pixi.js';
import type { SceneContext } from '../../core/Scene';
import { Button } from '../../ui/Button';
import { FactCard } from '../../ui/FactCard';
import { Portrait } from '../../ui/Portrait';
import { Stars } from '../../ui/Stars';
import { Theme } from '../../ui/Theme';
import { Tweens, ease } from './fx';
import { summaryTitle, type Customer } from './rules';

type T = (key: string, vars?: Record<string, string | number>) => string;

const INTRO_W = 1200;

/** Welcome card: the year, the queue of today's three customers, and the start button. */
export class Intro extends Container {
  private readonly tw = new Tweens();

  constructor(ctx: SceneContext, t: T, orders: Customer[], onStart: () => void) {
    super();
    const x0 = (1920 - INTRO_W) / 2;
    const content = new Container();
    let y = 44;

    const heading = new Text({
      text: t('glass.intro.h'),
      style: { fontFamily: Theme.font.display, fontWeight: '900', fontSize: 68, fill: Theme.color.star },
    });
    heading.anchor.set(0.5, 0);
    heading.position.set(INTRO_W / 2, y);
    y += heading.height + 18;

    const style = Theme.text.body(30);
    style.wordWrapWidth = INTRO_W - 120;
    style.align = 'center';
    const body = new Text({ text: t('glass.intro.p'), style });
    body.anchor.set(0.5, 0);
    body.position.set(INTRO_W / 2, y);
    y += body.height + 34;

    const queue = new Container();
    const gap = 300;
    orders.forEach((o, i) => {
      const p = new Portrait(ctx.assets.texture(`glass/portrait_${o.id}`), 140);
      p.position.set((i - (orders.length - 1) / 2) * gap, 76);
      const name = new Text({
        text: t(`glass.customers.${o.id}.name`),
        style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 24, fill: Theme.color.emberSoft },
      });
      name.anchor.set(0.5, 0);
      name.position.set(p.x, 164);
      queue.addChild(p, name);
      // the customers bob in the queue, one after another
      p.scale.set(0);
      this.tw.add(0.45, (k) => p.scale.set(k), { delay: 0.25 + i * 0.15, ease: ease.outBack });
    });
    queue.position.set(INTRO_W / 2, y);
    y += 210;

    const start = new Button(t('glass.intro.start'), {
      kiosk: ctx.kiosk,
      layout: ctx.layout,
      name: 'glass.start',
      width: 420,
      onTap: () => ctx.audio.play('ui.tap'),
      onPress: () => {
        start.enabled = false;
        onStart();
      },
    });
    start.position.set(INTRO_W / 2 - start.box.w / 2, y);
    y += start.box.h + 50;

    const card = new Graphics()
      .roundRect(0, 8, INTRO_W, y, 32)
      .fill({ color: Theme.color.night, alpha: 0.45 })
      .roundRect(0, 0, INTRO_W, y, 32)
      .fill({ color: Theme.color.night, alpha: 0.88 })
      .stroke({ color: Theme.color.ember, alpha: 0.6, width: 3 });
    content.addChild(card, heading, body, queue, start);
    content.position.set(x0, Math.max(150, (1080 + 110 - y) / 2));
    this.addChild(content);

    content.alpha = 0;
    const cy = content.y;
    this.tw.add(0.5, (p) => {
      content.alpha = p;
      content.y = cy + (1 - p) * 40;
    });
  }

  update(dt: number): void {
    this.tw.update(dt);
  }
}

const SUM_X = 60;

/** End of the shift: 9-star total, the title it earns, a last fact, play again / back to the map. */
export class Summary extends Container {
  private readonly tw = new Tweens();

  constructor(ctx: SceneContext, t: T, total: number, onAgain: () => void, onBack: () => void) {
    super();
    const key = summaryTitle(total);

    const heading = new Text({
      text: t('glass.sum.h'),
      style: { fontFamily: Theme.font.display, fontWeight: '900', fontSize: 72, fill: Theme.color.paper },
    });
    heading.position.set(SUM_X, 150);

    const stars = new Stars(9, 62);
    stars.position.set(SUM_X, heading.y + heading.height + 18);
    stars.onStar = () => ctx.audio.play('ui.star', { volume: 0.7 });

    const title = new Text({
      text: t(`glass.titles.${key}`),
      style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 64, fill: Theme.color.star },
    });
    title.position.set(SUM_X, stars.y + 62 + 26);

    const subStyle = Theme.text.body(32, Theme.color.emberSoft);
    subStyle.wordWrapWidth = 1000;
    const sub = new Text({ text: t(`glass.subs.${key}`), style: subStyle });
    sub.position.set(SUM_X, title.y + title.height + 6);

    const facts = ctx.i18n.get<string[]>('glass.facts') ?? [];
    const fact = new FactCard(t('ui.didYouKnow'), facts[3] ?? facts[0] ?? '', 1040);
    fact.position.set(SUM_X, sub.y + sub.height + 34);

    const again = new Button(t('glass.again'), {
      kiosk: ctx.kiosk,
      layout: ctx.layout,
      name: 'glass.again',
      onTap: () => ctx.audio.play('ui.tap'),
      onPress: () => {
        again.enabled = false;
        onAgain();
      },
    });
    const back = new Button(t('ui.back'), {
      kiosk: ctx.kiosk,
      layout: ctx.layout,
      variant: 'quiet',
      name: 'glass.back',
      onTap: () => ctx.audio.play('ui.tap'),
      onPress: () => {
        back.enabled = false;
        onBack();
      },
    });
    const by = Math.min(fact.y + fact.height + 34, 1080 - 30 - again.box.h);
    again.position.set(SUM_X, by);
    back.position.set(SUM_X + again.box.w + 24, by);

    this.addChild(heading, stars, title, sub, fact, again, back);

    [heading, title, sub, fact, again, back].forEach((v, i) => {
      const y = v.y;
      v.alpha = 0;
      this.tw.add(0.45, (p) => {
        v.alpha = p;
        v.y = y + (1 - p) * 30;
      }, { delay: i === 0 ? 0 : 0.3 + i * 0.12 });
    });
    title.scale.set(1);
    this.tw.add(0.6, (p) => title.scale.set(0.6 + 0.4 * p), { delay: 0.42, ease: ease.outBack });
    this.tw.wait(0.25, () => stars.set(total));
  }

  update(dt: number): void {
    this.tw.update(dt);
  }
}
