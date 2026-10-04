import { Rectangle, Text } from 'pixi.js';
import { DESIGN } from '../../core/Layout';
import { Scene } from '../../core/Scene';

/** Stub until Task 8: game title and a way back to the hub. */
export default class MineScene extends Scene {
  async init(): Promise<void> {
    const title = new Text({
      text: this.ctx.i18n.t('mine.title'),
      style: { fontFamily: 'Fraunces', fontWeight: '700', fontSize: 96, fill: 0xf3ead8 },
    });
    title.anchor.set(0.5);
    title.position.set(DESIGN.w / 2, DESIGN.h / 2 - 80);

    const back = new Text({
      text: this.ctx.i18n.t('ui.back'),
      style: { fontFamily: 'Nunito', fontWeight: '700', fontSize: 48, fill: 0xdd8a2c },
    });
    back.anchor.set(0.5);
    back.position.set(DESIGN.w / 2, DESIGN.h / 2 + 120);
    back.hitArea = new Rectangle(-back.width / 2 - 32, -60, back.width + 64, 120);
    back.eventMode = 'static';
    back.cursor = 'pointer';
    back.on('pointertap', () => this.ctx.go('hub'));

    this.addChild(title, back);
  }
}
