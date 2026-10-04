import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/Rng';
import {
  DECOYS,
  GRIND_LIMIT_S,
  HERBS,
  RECIPES,
  basketComplete,
  grindProgress,
  grindTimeLeft,
  grindTimedOut,
  pickResult,
  purity,
  spawnPlan,
  starsFor,
  verdict,
  type Recipe,
} from './rules';

const recipe = (id: Recipe['id']): Recipe => {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) throw new Error(id);
  return r;
};
const kaszel = recipe('kaszel');
const stluczenia = recipe('stluczenia');
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);

describe('content', () => {
  it('has three recipes made only of HERBS, and decoys outside HERBS', () => {
    expect(RECIPES.map((r) => r.id)).toEqual(['kaszel', 'stluczenia', 'zoladek']);
    for (const r of RECIPES) for (const h of r.herbs) expect(HERBS).toContain(h);
    for (const d of DECOYS) expect(HERBS).not.toContain(d);
  });
});

describe('spawnPlan', () => {
  it('shows every recipe herb at least twice', () => {
    for (const r of RECIPES) {
      for (const seed of SEEDS) {
        const plan = spawnPlan(mulberry32(seed), r);
        for (const h of r.herbs) expect(plan.filter((s) => s.plant === h).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps decoys out of the first 2 seconds', () => {
    for (const r of RECIPES) {
      for (const seed of SEEDS) {
        const plan = spawnPlan(mulberry32(seed), r);
        expect(plan.some((s) => s.t < 2)).toBe(true);
        for (const s of plan.filter((x) => x.t < 2)) expect(DECOYS).not.toContain(s.plant);
      }
    }
  });

  it('spawns one plant every 1.6–2.4 s, in rising order, within the round', () => {
    for (const seed of SEEDS) {
      const plan = spawnPlan(mulberry32(seed), kaszel, 40);
      expect(plan[0].t).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < plan.length; i++) {
        const gap = plan[i].t - plan[i - 1].t;
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeGreaterThanOrEqual(1.6 - 1e-9);
        expect(gap).toBeLessThanOrEqual(2.4 + 1e-9);
      }
      expect(plan[plan.length - 1].t).toBeLessThan(40);
    }
  });

  it('mixes about 30 % other herbs and 20 % decoys', () => {
    for (const r of RECIPES) {
      for (const seed of SEEDS) {
        const plan = spawnPlan(mulberry32(seed), r);
        const n = plan.length;
        const decoys = plan.filter((s) => DECOYS.includes(s.plant)).length;
        const others = plan.filter((s) => HERBS.includes(s.plant) && !r.herbs.includes(s.plant)).length;
        expect(decoys).toBe(Math.round(n * 0.2));
        expect(others).toBe(Math.round(n * 0.3));
      }
    }
  });

  it('puts plants on lanes 0–2, never twice in a row on the same lane', () => {
    for (const seed of SEEDS) {
      const plan = spawnPlan(mulberry32(seed), stluczenia);
      for (const s of plan) expect([0, 1, 2]).toContain(s.lane);
      for (let i = 1; i < plan.length; i++) expect(plan[i].lane).not.toBe(plan[i - 1].lane);
    }
  });

  it('brings every recipe herb once before any of them comes twice', () => {
    for (const r of RECIPES) {
      for (const seed of SEEDS) {
        const plan = spawnPlan(mulberry32(seed), r).filter((s) => r.herbs.includes(s.plant));
        const first = plan.slice(0, r.herbs.length).map((s) => s.plant);
        expect([...first].sort()).toEqual([...r.herbs].sort());
      }
    }
  });

  it('is deterministic for a seed and scales with the round length', () => {
    expect(spawnPlan(mulberry32(5), kaszel)).toEqual(spawnPlan(mulberry32(5), kaszel));
    expect(spawnPlan(mulberry32(5), kaszel, 20).length).toBeLessThan(spawnPlan(mulberry32(5), kaszel, 40).length);
  });

  it('still fits every recipe herb twice into a very short round', () => {
    const plan = spawnPlan(mulberry32(3), kaszel, 4);
    for (const h of kaszel.herbs) expect(plan.filter((s) => s.plant === h).length).toBeGreaterThanOrEqual(2);
  });
});

describe('pickResult', () => {
  it('sorts a tap into needed / duplicate / wrong / decoy', () => {
    expect(pickResult([], 'arnika', stluczenia)).toBe('needed');
    expect(pickResult(['arnika'], 'arnika', stluczenia)).toBe('duplicate');
    expect(pickResult([], 'mieta', stluczenia)).toBe('wrong');
    expect(pickResult([], 'muchomor', stluczenia)).toBe('decoy');
    expect(pickResult(['arnika'], 'pokrzywa', stluczenia)).toBe('decoy');
  });
});

describe('basketComplete', () => {
  it('is true once every recipe herb is in, whatever else is there', () => {
    expect(basketComplete([], stluczenia)).toBe(false);
    expect(basketComplete(['arnika'], stluczenia)).toBe(false);
    expect(basketComplete(['dziewieciesil', 'arnika'], stluczenia)).toBe(true);
    expect(basketComplete(['arnika', 'arnika', 'dziewieciesil'], stluczenia)).toBe(true);
    expect(basketComplete(['podbial', 'pierwiosnek'], kaszel)).toBe(false);
  });
});

describe('purity', () => {
  it('is needed / (needed + wrong + decoy); duplicates do not count', () => {
    expect(purity(['needed', 'needed', 'wrong'])).toBeCloseTo(0.667, 3);
    expect(purity(['needed', 'decoy'])).toBe(0.5);
    expect(purity(['needed', 'duplicate', 'duplicate'])).toBe(1);
    expect(purity(['wrong', 'decoy'])).toBe(0);
  });

  it('is 1 with no picks', () => {
    expect(purity([])).toBe(1);
  });
});

describe('grindProgress', () => {
  it('needs four full turns, either way round, and stops at 1', () => {
    expect(grindProgress(2 * Math.PI, 0)).toBe(0.25);
    expect(grindProgress(-2 * Math.PI, 0.25)).toBe(0.5);
    expect(grindProgress(Math.PI, 0.9)).toBe(1);
    expect(grindProgress(0, 0.3)).toBe(0.3);
  });
});

describe('grind time limit', () => {
  it('ends the grind by itself 30 s after the mortar comes up', () => {
    expect(GRIND_LIMIT_S).toBe(30);
    expect(grindTimedOut(0)).toBe(false);
    expect(grindTimedOut(29.9)).toBe(false);
    expect(grindTimedOut(30)).toBe(true);
    expect(grindTimedOut(31.5)).toBe(true);
  });

  it('shows the time left as a share from 1 down to 0', () => {
    expect(grindTimeLeft(0)).toBe(1);
    expect(grindTimeLeft(15)).toBeCloseTo(0.5);
    expect(grindTimeLeft(30)).toBe(0);
    expect(grindTimeLeft(40)).toBe(0);
  });

  it('still scores a timed-out grind: 1 or 2 stars, never 3, and calls a clean basket slow', () => {
    for (const p of [0, 0.3, 0.59, 0.6, 0.9, 1]) {
      const stars = starsFor(p, GRIND_LIMIT_S);
      expect(stars, `purity ${p}`).toBeGreaterThanOrEqual(1);
      expect(stars, `purity ${p}`).toBeLessThanOrEqual(2);
    }
    expect(verdict([...kaszel.herbs], ['needed', 'needed', 'needed'], kaszel, GRIND_LIMIT_S)).toBe('slow');
  });
});

describe('starsFor', () => {
  it('gives 3 for a clean basket ground fast, 2 for a fair one, else 1', () => {
    expect(starsFor(1, 5)).toBe(3);
    expect(starsFor(0.9, 8)).toBe(3);
    expect(starsFor(1, 9)).toBe(2);
    expect(starsFor(0.7, 20)).toBe(2);
    expect(starsFor(0.6, 3)).toBe(2);
    expect(starsFor(0.3, 5)).toBe(1);
    expect(starsFor(0, 1)).toBe(1);
  });
});

describe('verdict', () => {
  it('names the main reason a remedy lost stars: missing herbs, then wrong picks, then slow grinding', () => {
    expect(verdict(['arnika'], ['needed', 'wrong'], stluczenia, 20)).toBe('missing');
    expect(verdict(['arnika', 'dziewieciesil'], ['needed', 'decoy', 'needed'], stluczenia, 20)).toBe('wrong');
    expect(verdict(['arnika', 'dziewieciesil'], ['needed', 'needed', 'duplicate'], stluczenia, 9)).toBe('slow');
    expect(verdict(['dziewieciesil', 'arnika'], ['needed', 'needed'], stluczenia, 8)).toBe('perfect');
  });

  it('agrees with starsFor: a perfect verdict is always 3 stars', () => {
    expect(starsFor(purity(['needed', 'needed']), 8)).toBe(3);
  });
});
