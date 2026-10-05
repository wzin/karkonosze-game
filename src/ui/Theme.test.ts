import { it, expect, vi } from 'vitest';

// jsdom has no 2D canvas; Pixi probes one on import and jsdom would log "Not implemented".
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { LiveHitBox, MIN_TOUCH_CSS, Theme, effectiveHitMin, hitBox } from './Theme';

it('asks for 96 px hit boxes on the kiosk and 64 px elsewhere', () => {
  expect(Theme.size.hitMin(true)).toBe(96);
  expect(Theme.size.hitMin(false)).toBe(64);
});

it('makes the default button tall enough for the kiosk', () => {
  expect(Theme.size.button.h).toBeGreaterThanOrEqual(Theme.size.hitMin(true));
});

it('grows a small kiosk target to 96 x 96 around its centre', () => {
  expect(hitBox(40, 30, true)).toEqual({ x: -28, y: -33, width: 96, height: 96 });
});

it('grows a small regular target to 64 px only', () => {
  expect(hitBox(40, 30, false)).toEqual({ x: -12, y: -17, width: 64, height: 64 });
});

it('keeps a target that is already big enough', () => {
  expect(hitBox(300, 96, true)).toEqual({ x: 0, y: 0, width: 300, height: 96 });
});

it('grows only the side that is too small', () => {
  expect(hitBox(300, 72, true)).toEqual({ x: 0, y: -12, width: 300, height: 96 });
});

it('keeps the design floor (96 kiosk / 64 elsewhere) at full scale', () => {
  expect(effectiveHitMin(true, 1)).toBe(96);
  expect(effectiveHitMin(false, 1)).toBe(64);
});

it('raises the minimum so a target never maps to under 44 CSS px on a small screen', () => {
  // 844×390 landscape phone: fit scale 390 / 1080 ≈ 0.36
  expect(MIN_TOUCH_CSS).toBe(44);
  expect(effectiveHitMin(false, 0.36)).toBeGreaterThanOrEqual(123);
  expect(effectiveHitMin(true, 0.36)).toBeGreaterThanOrEqual(123);
  for (const scale of [1, 0.6, 0.36, 0.296, 0.203]) {
    for (const kiosk of [false, true]) {
      expect(effectiveHitMin(kiosk, scale) * scale, `scale ${scale}`).toBeGreaterThanOrEqual(MIN_TOUCH_CSS);
      expect(effectiveHitMin(kiosk, scale)).toBeGreaterThanOrEqual(Theme.size.hitMin(kiosk));
    }
  }
});

it('falls back to the design floor for a scale that is not positive', () => {
  expect(effectiveHitMin(false, 0)).toBe(64);
  expect(effectiveHitMin(true, Number.NaN)).toBe(96);
});

it('grows a hit box by the fit scale too', () => {
  expect(hitBox(300, 96, false, 0.36)).toEqual({ x: 0, y: -13.5, width: 300, height: 123 });
});

it('re-sizes a live hit box when the fit scale changes, without rebuilding it', () => {
  const layout = { scale: 1 };
  const area = new LiveHitBox(() => ({ x: 10, y: 20, w: 72, h: 72 }), false, layout);
  // 72 is above the 64 floor: at full scale the box is the target itself
  expect(area.contains(10 + 36, 20 + 36)).toBe(true);
  expect(area.box).toEqual({ x: 10, y: 20, width: 72, height: 72 });
  expect(area.contains(10 - 20, 20 + 36)).toBe(false);
  layout.scale = 0.36;
  expect(area.box).toEqual({ x: 10 - 25.5, y: 20 - 25.5, width: 123, height: 123 });
  expect(area.contains(10 - 20, 20 + 36)).toBe(true);
});

it('builds text styles from the theme fonts', () => {
  const title = Theme.text.title();
  expect(title.fontFamily).toBe(Theme.font.display);
  expect(title.fontSize).toBe(56);
  const body = Theme.text.body(24, Theme.color.ink);
  expect(body.fontFamily).toBe(Theme.font.body);
  expect(body.fontSize).toBe(24);
  expect(body.lineHeight).toBeCloseTo(24 * 1.35);
  expect(body.fill).toBe(Theme.color.ink);
  expect(body.wordWrap).toBe(true);
});
