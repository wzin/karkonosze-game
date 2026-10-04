import { it, expect, vi } from 'vitest';

// jsdom has no 2D canvas; Pixi probes one on import and jsdom would log "Not implemented".
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { Theme, hitBox } from './Theme';

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
