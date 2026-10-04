import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../core/Rng';
import {
  HITS,
  ROCK_ZONES,
  VEIN_AREA,
  VEIN_GAP,
  dist,
  geigerLevel,
  hit,
  isLit,
  levelConfig,
  minedCount,
  starsFor,
  type Vein,
} from './rules';

const LEVELS = [1, 2, 3] as const;

function vein(over: Partial<Vein> = {}): Vein {
  return { id: 0, x: 0, y: 0, type: 'uranium', hitsLeft: HITS, ...over };
}

function count(veins: Vein[], type: Vein['type']): number {
  return veins.filter((v) => v.type === type).length;
}

describe('levelConfig', () => {
  it('level 1: five iron veins, 60 s of oil, a wide lamp, two drips and no bats', () => {
    const l = levelConfig(1, mulberry32(1));
    expect(l.index).toBe(1);
    expect(l.bg).toBe('mine/bg_1');
    expect(l.veins).toHaveLength(5);
    expect(count(l.veins, 'iron')).toBe(5);
    expect(l.oilSeconds).toBe(60);
    expect(l.lampRadius).toBe(0.22);
    expect(l.drips).toHaveLength(2);
    expect(l.bats).toBe(0);
  });

  it('level 2: four iron and two uranium veins, 55 s, r 0.2, three drips, one bat', () => {
    const l = levelConfig(2, mulberry32(2));
    expect(l.bg).toBe('mine/bg_2');
    expect(count(l.veins, 'iron')).toBe(4);
    expect(count(l.veins, 'uranium')).toBe(2);
    expect(l.oilSeconds).toBe(55);
    expect(l.lampRadius).toBe(0.2);
    expect(l.drips).toHaveLength(3);
    expect(l.bats).toBe(1);
  });

  it('level 3: two iron and five uranium veins, 50 s, r 0.18, four drips, two bats', () => {
    const l = levelConfig(3, mulberry32(3));
    expect(l.bg).toBe('mine/bg_3');
    expect(l.veins.filter((v) => v.type === 'uranium').length).toBe(5);
    expect(count(l.veins, 'iron')).toBe(2);
    expect(l.oilSeconds).toBe(50);
    expect(l.lampRadius).toBe(0.18);
    expect(l.drips).toHaveLength(4);
    expect(l.bats).toBe(2);
  });

  it('starts every vein whole, with its own id', () => {
    for (const index of LEVELS) {
      const { veins } = levelConfig(index, mulberry32(index * 7));
      expect(veins.every((v) => v.hitsLeft === HITS)).toBe(true);
      expect(new Set(veins.map((v) => v.id)).size).toBe(veins.length);
    }
  });

  it('keeps veins at least 220 px apart, inside the play area and on rock, for any seed', () => {
    expect(VEIN_GAP).toBe(220);
    for (let seed = 1; seed <= 300; seed++) {
      for (const index of LEVELS) {
        const l = levelConfig(index, mulberry32(seed));
        for (const [i, a] of l.veins.entries()) {
          expect(a.x).toBeGreaterThanOrEqual(VEIN_AREA.x0);
          expect(a.x).toBeLessThanOrEqual(VEIN_AREA.x1);
          expect(a.y).toBeGreaterThanOrEqual(VEIN_AREA.y0);
          expect(a.y).toBeLessThanOrEqual(VEIN_AREA.y1);
          const onRock = ROCK_ZONES[l.bg].some((z) => a.x >= z.x0 && a.x <= z.x1 && a.y >= z.y0 && a.y <= z.y1);
          expect(onRock, `seed ${seed} level ${index} vein ${a.id} at ${a.x},${a.y}`).toBe(true);
          for (const b of l.veins.slice(i + 1)) {
            expect(dist(a, b), `seed ${seed} level ${index}`).toBeGreaterThanOrEqual(VEIN_GAP);
          }
        }
      }
    }
  });

  it('rock zones lie inside the play area', () => {
    for (const zones of Object.values(ROCK_ZONES)) {
      for (const z of zones) {
        expect(z.x0).toBeGreaterThanOrEqual(VEIN_AREA.x0);
        expect(z.x1).toBeLessThanOrEqual(VEIN_AREA.x1);
        expect(z.y0).toBeGreaterThanOrEqual(VEIN_AREA.y0);
        expect(z.y1).toBeLessThanOrEqual(VEIN_AREA.y1);
      }
    }
  });

  it('mixes the ore types, so uranium is not always in the same spots', () => {
    const firstUranium = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      firstUranium.add(levelConfig(2, mulberry32(seed)).veins.findIndex((v) => v.type === 'uranium'));
    }
    expect(firstUranium.size).toBeGreaterThan(1);
  });

  it('drips fall inside the play area at a steady period', () => {
    for (const index of LEVELS) {
      for (const d of levelConfig(index, mulberry32(11)).drips) {
        expect(d.x).toBeGreaterThanOrEqual(VEIN_AREA.x0);
        expect(d.x).toBeLessThanOrEqual(VEIN_AREA.x1);
        expect(d.periodS).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic for a seed', () => {
    expect(levelConfig(3, mulberry32(42))).toEqual(levelConfig(3, mulberry32(42)));
  });
});

describe('dist and isLit', () => {
  it('measures straight-line distance', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(dist({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  it('lights a point up to and including the radius', () => {
    const lamp = { x: 100, y: 100 };
    expect(isLit(lamp, { x: 100, y: 200 }, 100)).toBe(true);
    expect(isLit(lamp, { x: 100, y: 201 }, 100)).toBe(false);
  });
});

describe('geigerLevel', () => {
  const lamp = { x: 0, y: 0 };

  it('crackles by the distance to the nearest uranium vein', () => {
    expect(geigerLevel(lamp, [vein({ x: 159 })])).toBe(3);
    expect(geigerLevel(lamp, [vein({ x: 160 })])).toBe(2);
    expect(geigerLevel(lamp, [vein({ x: 359 })])).toBe(2);
    expect(geigerLevel(lamp, [vein({ x: 360 })])).toBe(1);
    expect(geigerLevel(lamp, [vein({ x: 639 })])).toBe(1);
    expect(geigerLevel(lamp, [vein({ x: 640 })])).toBe(0);
  });

  it('takes the nearest uranium vein', () => {
    expect(geigerLevel(lamp, [vein({ x: 600 }), vein({ y: 100 })])).toBe(3);
  });

  it('ignores iron and mined-out uranium', () => {
    expect(geigerLevel(lamp, [vein({ type: 'iron', x: 10 })])).toBe(0);
    expect(geigerLevel(lamp, [vein({ x: 10, hitsLeft: 0 }), vein({ x: 500 })])).toBe(1);
    expect(geigerLevel(lamp, [])).toBe(0);
  });
});

describe('hit and minedCount', () => {
  it('takes one hit off and never goes below zero', () => {
    const v = vein();
    expect(hit(v).hitsLeft).toBe(HITS - 1);
    expect(hit(hit(hit(v))).hitsLeft).toBe(0);
    expect(hit(vein({ hitsLeft: 0 })).hitsLeft).toBe(0);
  });

  it('returns a new vein and leaves the old one alone', () => {
    const v = vein();
    const after = hit(v);
    expect(after).not.toBe(v);
    expect(v.hitsLeft).toBe(HITS);
    expect(after).toEqual({ ...v, hitsLeft: HITS - 1 });
  });

  it('counts veins with no hits left', () => {
    expect(minedCount([vein({ hitsLeft: 0 }), vein({ hitsLeft: 1 }), vein({ hitsLeft: 0 })])).toBe(2);
    expect(minedCount([])).toBe(0);
  });
});

describe('starsFor', () => {
  it('gives 3 stars for everything, 2 from 60 %, else 1', () => {
    expect(starsFor(5, 5)).toBe(3);
    expect(starsFor(4, 5)).toBe(2);
    expect(starsFor(3, 5)).toBe(2);
    expect(starsFor(2, 5)).toBe(1);
    expect(starsFor(1, 5)).toBe(1);
    expect(starsFor(0, 5)).toBe(1);
    expect(starsFor(11, 18)).toBe(2);
    expect(starsFor(18, 18)).toBe(3);
  });
});
