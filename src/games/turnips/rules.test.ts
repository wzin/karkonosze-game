import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/Rng';
import { answerOptions, fieldSlots, planWave, roundConfig, splitIntoGroups, starsFor } from './rules';

describe('roundConfig', () => {
  it('starts with four turnips and clamps past the last round', () => {
    expect(roundConfig(1).count).toBe(4);
    expect(roundConfig(9).count).toBe(14);
    expect(roundConfig(9).round).toBe(9);
    expect(roundConfig(0).count).toBe(4);
  });

  it('gets harder every round and changes the weather each time', () => {
    const waves = [1, 2, 3, 4, 5].map(roundConfig);
    for (let i = 1; i < waves.length; i++) {
      expect(waves[i].count).toBeGreaterThan(waves[i - 1].count);
      expect(waves[i].showMs).toBeLessThan(waves[i - 1].showMs);
      expect(waves[i].weather).not.toBe(waves[i - 1].weather);
    }
    expect(waves.map((w) => w.weather).sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('splitIntoGroups', () => {
  it('sums to count with every group at least 1, over 100 draws', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 100; i++) {
      const count = 2 + Math.floor(rng() * 15);
      const groups = 1 + Math.floor(rng() * 4);
      const out = splitIntoGroups(rng, count, groups);
      expect(out).toHaveLength(Math.min(groups, count));
      expect(out.reduce((a, b) => a + b, 0)).toBe(count);
      expect(Math.min(...out)).toBeGreaterThanOrEqual(1);
    }
  });

  it('never makes fewer groups than asked when there are enough turnips', () => {
    const rng = mulberry32(5);
    for (let r = 1; r <= 5; r++) {
      const { count, groups } = roundConfig(r);
      expect(splitIntoGroups(rng, count, groups)).toHaveLength(groups);
    }
  });

  it('keeps groups countable: none above ceil(count / groups) + 1', () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 100; i++) {
      const out = splitIntoGroups(rng, 14, 4);
      expect(Math.max(...out)).toBeLessThanOrEqual(Math.ceil(14 / 4) + 1);
    }
  });

  it('cannot split more groups than turnips', () => {
    expect(splitIntoGroups(mulberry32(1), 2, 4)).toEqual([1, 1]);
    expect(splitIntoGroups(mulberry32(1), 0, 3)).toEqual([]);
  });
});

describe('answerOptions', () => {
  it('gives 4 unique non-negative options with the answer among them', () => {
    const rng = mulberry32(3);
    for (let correct = 0; correct <= 20; correct++) {
      for (let i = 0; i < 20; i++) {
        const out = answerOptions(rng, correct);
        expect(out).toHaveLength(4);
        expect(new Set(out).size).toBe(4);
        expect(out).toContain(correct);
        for (const n of out) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(Math.abs(n - correct)).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('works next to zero (correct 0, 1, 2)', () => {
    const rng = mulberry32(4);
    for (const correct of [0, 1, 2]) {
      const out = answerOptions(rng, correct);
      expect(out).toContain(correct);
      expect(out.every((n) => n >= 0)).toBe(true);
      expect(new Set(out).size).toBe(4);
    }
    expect([...answerOptions(rng, 0)].sort()).toEqual([0, 1, 2, 3]);
  });

  it('shuffles: the answer does not always sit on the same tile', () => {
    const rng = mulberry32(6);
    const places = new Set(Array.from({ length: 40 }, () => answerOptions(rng, 8).indexOf(8)));
    expect(places.size).toBeGreaterThan(1);
  });
});

describe('fieldSlots', () => {
  it('has 18 unique positions by default', () => {
    const slots = fieldSlots();
    expect(slots).toHaveLength(18);
    expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(18);
  });

  it('lays rows back to front, inside the screen', () => {
    const slots = fieldSlots(6, 3);
    const rows = [0, 1, 2].map((r) => slots.slice(r * 6, r * 6 + 6));
    for (const row of rows) for (const s of row) expect(s.y).toBe(row[0].y);
    expect(rows[0][0].y).toBeLessThan(rows[1][0].y);
    expect(rows[1][0].y).toBeLessThan(rows[2][0].y);
    for (const s of slots) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(1920);
      expect(s.y).toBeLessThan(1080);
    }
  });

  it('zigzags: no slot stands right in front of a slot of the row behind', () => {
    const slots = fieldSlots(6, 3);
    const rows = [0, 1, 2].map((r) => slots.slice(r * 6, r * 6 + 6));
    const spacing = rows[0][1].x - rows[0][0].x;
    for (let r = 1; r < rows.length; r++) {
      for (const s of rows[r]) {
        const nearest = Math.min(...rows[r - 1].map((b) => Math.abs(b.x - s.x)));
        expect(nearest).toBeGreaterThanOrEqual(spacing * 0.45);
      }
    }
  });

  it('follows cols and rows', () => {
    expect(fieldSlots(4, 2)).toHaveLength(8);
    expect(fieldSlots(1, 1)).toHaveLength(1);
  });
});

describe('starsFor', () => {
  it('maps correct rounds to stars', () => {
    expect(starsFor(5)).toBe(3);
    expect(starsFor(4)).toBe(2);
    expect(starsFor(3)).toBe(2);
    expect(starsFor(2)).toBe(1);
    expect(starsFor(0)).toBe(1);
  });
});

describe('planWave', () => {
  it('places every turnip and stone once, never twice on the same mound', () => {
    const slots = fieldSlots().length;
    for (let seed = 1; seed <= 50; seed++) {
      const rng = mulberry32(seed);
      for (let r = 1; r <= 5; r++) {
        const wave = roundConfig(r);
        const groups = planWave(rng, wave, slots);
        const all = groups.flat();
        expect(groups).toHaveLength(wave.groups);
        expect(all.filter((p) => !p.stone)).toHaveLength(wave.count);
        expect(all.filter((p) => p.stone)).toHaveLength(wave.decoys);
        expect(new Set(all.map((p) => p.slot)).size).toBe(all.length);
        for (const p of all) {
          expect(p.slot).toBeGreaterThanOrEqual(0);
          expect(p.slot).toBeLessThan(slots);
        }
        for (const g of groups) expect(g.some((p) => !p.stone)).toBe(true);
      }
    }
  });

  it('spreads the stones over different groups', () => {
    const groups = planWave(mulberry32(2), roundConfig(4), 18);
    for (const g of groups) expect(g.filter((p) => p.stone).length).toBeLessThanOrEqual(1);
  });

  it('drops stones that do not fit on the field', () => {
    const all = planWave(mulberry32(9), roundConfig(5), 16).flat();
    expect(all.filter((p) => !p.stone)).toHaveLength(14);
    expect(all).toHaveLength(16);
  });
});
