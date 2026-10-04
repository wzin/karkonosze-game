import { it, expect, vi } from 'vitest';

// jsdom has no canvas: Pixi probes one on import.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { Tweens, bezier, ease, mixColor } from './fx';
import { vesselHeight } from './steps/Shape';

it('runs a tween to its end value and then its done callback', () => {
  const tw = new Tweens();
  const seen: number[] = [];
  const done = vi.fn();
  tw.add(1, (v) => seen.push(v), { ease: ease.linear, done });
  tw.update(0.5);
  tw.update(0.5);
  tw.update(0.5);
  expect(seen).toEqual([0.5, 1]);
  expect(done).toHaveBeenCalledTimes(1);
});

it('honours delays and lets callbacks schedule more tweens', () => {
  const tw = new Tweens();
  const order: string[] = [];
  tw.wait(0.2, () => {
    order.push('first');
    tw.wait(0, () => order.push('second'));
  });
  tw.update(0.1);
  expect(order).toEqual([]);
  tw.update(0.1);
  expect(order).toEqual(['first']);
  tw.update(0.016);
  expect(order).toEqual(['first', 'second']);
});

it('drops everything on clear', () => {
  const tw = new Tweens();
  const done = vi.fn();
  tw.wait(0.1, done);
  tw.clear();
  tw.update(1);
  expect(done).not.toHaveBeenCalled();
});

it('eases end at 0 and 1', () => {
  for (const f of Object.values(ease)) {
    expect(f(0)).toBeCloseTo(0);
    expect(f(1)).toBeCloseTo(1);
  }
});

it('mixes colours per channel and clamps k', () => {
  expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  expect(mixColor(0x102030, 0xffffff, 0)).toBe(0x102030);
  expect(mixColor(0x102030, 0x405060, 2)).toBe(0x405060);
});

it('walks a quadratic Bézier from a to b', () => {
  const a = { x: 0, y: 0 };
  const c = { x: 50, y: -100 };
  const b = { x: 100, y: 0 };
  expect(bezier(a, c, b, 0)).toEqual(a);
  expect(bezier(a, c, b, 1)).toEqual(b);
  expect(bezier(a, c, b, 0.5)).toEqual({ x: 50, y: -50 });
});

it('turns the blown radius into a vessel height within bounds', () => {
  expect(vesselHeight(230)).toBeCloseTo(253);
  expect(vesselHeight(10)).toBe(120);
  expect(vesselHeight(1000)).toBe(330);
});
