import { describe, it, expect } from 'vitest';
import { DESIGN, fitScale } from './Layout';

describe('fitScale', () => {
  it('letterboxes a wide viewport', () => {
    const f = fitScale(3840, 1080);
    expect(f.scale).toBe(1);
    expect(f.x).toBe(960);
    expect(f.y).toBe(0);
    expect(f.portrait).toBe(false);
  });

  it('fits portrait phone by width and flags portrait', () => {
    const f = fitScale(390, 844);
    expect(f.scale).toBeCloseTo(390 / 1920, 5);
    expect(f.portrait).toBe(true);
    expect(f.y).toBeGreaterThan(0);
  });

  it('centres the scaled design space in the viewport', () => {
    const f = fitScale(1280, 800);
    expect(f.scale).toBeCloseTo(1280 / DESIGN.w, 5);
    expect(f.x).toBeCloseTo(0, 5);
    expect(f.y * 2 + DESIGN.h * f.scale).toBeCloseTo(800, 5);
  });
});
