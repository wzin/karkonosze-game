import { TextStyle } from 'pixi.js';

/**
 * Shared look of every scene: the two web fonts loaded by main.ts, the dusk palette and the sizes
 * that keep touch targets large enough (96 px on the museum kiosk, 64 px elsewhere).
 */
export const Theme = {
  font: { display: 'Fraunces', body: 'Nunito' },
  color: {
    ink: 0x1f2b2e,
    paper: 0xf6ead6,
    ember: 0xdd8a2c,
    emberSoft: 0xf7e2c6,
    glass: 0x2a8a6b,
    dusk: 0x5a4a8c,
    night: 0x141a26,
    star: 0xffcf66,
    bad: 0xc2304a,
  },
  size: { button: { h: 96, minW: 240, radius: 28 }, hitMin: (kiosk: boolean) => (kiosk ? 96 : 64) },
  text: {
    title: (size = 56) => new TextStyle({ fontFamily: 'Fraunces', fontWeight: '700', fontSize: size, fill: 0xf6ead6 }),
    body: (size = 30, fill = 0xf6ead6) =>
      new TextStyle({
        fontFamily: 'Nunito',
        fontWeight: '600',
        fontSize: size,
        fill,
        wordWrap: true,
        wordWrapWidth: 900,
        lineHeight: size * 1.35,
      }),
  },
};

export interface HitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Hit area for a `width`×`height` target drawn from (0, 0): each side grows to at least
 * `Theme.size.hitMin(kiosk)`, evenly around the target's centre, so small icons stay easy to hit.
 */
export function hitBox(width: number, height: number, kiosk: boolean): HitBox {
  const min = Theme.size.hitMin(kiosk);
  const w = Math.max(width, min);
  const h = Math.max(height, min);
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
