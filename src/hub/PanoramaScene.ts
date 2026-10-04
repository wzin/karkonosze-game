import { FillGradient, Graphics, Text } from 'pixi.js';
import { DESIGN } from '../core/Layout';
import { Scene } from '../core/Scene';

/** Stub until Task 5: dusk sky gradient with the app title. */
export default class PanoramaScene extends Scene {
  async init(): Promise<void> {
    const sky = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0x1d2a4a },
        { offset: 0.6, color: 0x6b5a7a },
        { offset: 1, color: 0xdd8a2c },
      ],
    });
    const background = new Graphics().rect(0, 0, DESIGN.w, DESIGN.h).fill(sky);

    const title = new Text({
      text: this.ctx.i18n.t('app.title'),
      style: { fontFamily: 'Fraunces', fontWeight: '900', fontSize: 120, fill: 0xf3ead8 },
    });
    title.anchor.set(0.5);
    title.position.set(DESIGN.w / 2, DESIGN.h / 2 - 60);

    const subtitle = new Text({
      text: this.ctx.i18n.t('app.subtitle'),
      style: { fontFamily: 'Nunito', fontWeight: '600', fontSize: 44, fill: 0xf3ead8 },
    });
    subtitle.anchor.set(0.5);
    subtitle.position.set(DESIGN.w / 2, DESIGN.h / 2 + 60);

    this.addChild(background, title, subtitle);
  }
}
