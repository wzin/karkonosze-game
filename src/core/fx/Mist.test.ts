import { describe, it, expect, vi } from 'vitest';

// jsdom has no canvas; Pixi probes one on import.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { bob, wrapPair } from './Mist';

/** The span the two copies cover, as [left, right]. */
function span([a, b]: [number, number], w: number): [number, number] {
  return [Math.min(a, b), Math.max(a, b) + w];
}

describe('wrapPair', () => {
  const w = 2000;

  it('starts with the plain copy at 0 and the mirrored one right after it', () => {
    expect(wrapPair(0, w)).toEqual([0, w]);
  });

  it('always covers the tile width from 0, scrolling either way', () => {
    for (const offset of [0, 1, 999, 1999, 2000, 2001, 3999, 4000, 12345, -1, -500, -2000, -3999, -7777]) {
      const [left, right] = span(wrapPair(offset, w), w);
      expect(left, `offset ${offset}`).toBeLessThanOrEqual(0);
      expect(right, `offset ${offset}`).toBeGreaterThanOrEqual(w);
    }
  });

  it('keeps the copies edge to edge', () => {
    for (const offset of [0, 700, 2500, -300]) {
      const [a, b] = wrapPair(offset, w);
      expect(Math.abs(a - b)).toBeCloseTo(w, 6);
    }
  });

  it('repeats every two tile widths', () => {
    expect(wrapPair(300 + 2 * w, w)).toEqual(wrapPair(300, w));
    expect(wrapPair(300 - 2 * w, w)).toEqual(wrapPair(300, w));
  });

  it('moves the copies left as the offset grows', () => {
    const [a0] = wrapPair(100, w);
    const [a1] = wrapPair(110, w);
    expect(a1 - a0).toBeCloseTo(-10, 6);
  });
});

describe('bob', () => {
  it('swings by the amplitude once per period', () => {
    expect(bob(0, 6, 20)).toBeCloseTo(0, 6);
    expect(bob(5, 6, 20)).toBeCloseTo(6, 6);
    expect(bob(15, 6, 20)).toBeCloseTo(-6, 6);
    expect(bob(20, 6, 20)).toBeCloseTo(0, 6);
  });
});
