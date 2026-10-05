import { TextStyle } from 'pixi.js';
import type { ViewLayout } from '../core/Layout';

/**
 * Shared look of every scene: the two web fonts loaded by main.ts, the dusk palette and the sizes
 * that keep touch targets large enough (96 design px on the museum kiosk, 64 elsewhere, and never
 * under 44 CSS px on screen: see effectiveHitMin).
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

/** Smallest touch target on screen, in CSS px (the plan's phone minimum), whatever the fit scale. */
export const MIN_TOUCH_CSS = 44;

/**
 * Smallest hit-area side in design px at fit `scale` (CSS px per design px): the design floor
 * `Theme.size.hitMin(kiosk)`, raised on small screens so it never maps to under MIN_TOUCH_CSS. On an
 * 844×390 phone (scale ≈ 0.36) that is 123 design px instead of 64.
 */
export function effectiveHitMin(kiosk: boolean, scale: number): number {
  const floor = Theme.size.hitMin(kiosk);
  return scale > 0 ? Math.max(floor, Math.ceil(MIN_TOUCH_CSS / scale)) : floor;
}

/**
 * Hit area for a `width`×`height` target drawn from (0, 0): each side grows to at least
 * `effectiveHitMin(kiosk, scale)`, evenly around the target's centre, so small icons stay easy to hit.
 */
export function hitBox(width: number, height: number, kiosk: boolean, scale = 1): HitBox {
  const min = effectiveHitMin(kiosk, scale);
  const w = Math.max(width, min);
  const h = Math.max(height, min);
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/**
 * A Pixi hit area (`contains`) for the target rect `target()` returns, grown like hitBox() from the
 * live fit scale on every test: a resize or a turned phone re-sizes it with nothing rebuilt. Without
 * a layout it uses scale 1 (the design floor only).
 */
export class LiveHitBox {
  constructor(
    private readonly target: () => { x?: number; y?: number; w: number; h: number },
    private readonly kiosk: boolean,
    private readonly layout?: ViewLayout,
  ) {}

  /** The current hit box, in the target's own space. */
  get box(): HitBox {
    const t = this.target();
    const b = hitBox(t.w, t.h, this.kiosk, this.layout?.scale ?? 1);
    return { x: b.x + (t.x ?? 0), y: b.y + (t.y ?? 0), width: b.width, height: b.height };
  }

  contains(x: number, y: number): boolean {
    const b = this.box;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  }
}
