import { it, expect, describe } from 'vitest';
import { mulberry32 } from '../../core/Rng';
import {
  BLOW,
  CUSTOMERS,
  HEAT,
  LIMITS,
  MINERALS,
  SHAPES,
  blowScore,
  heatScore,
  needlePos,
  noteKeys,
  orderScore,
  pickOrders,
  popped,
  reactionKey,
  saveStars,
  starsFor,
  summaryTitle,
} from './rules';

describe('heat', () => {
  it('scores the middle of the ember zone 1 and anything outside it the miss score', () => {
    expect(heatScore(0.5)).toBe(1);
    expect(heatScore(0.9)).toBe(0.15);
    expect(heatScore(0.1)).toBe(HEAT.missScore);
  });

  it('falls off linearly inside the zone and keeps its edge', () => {
    expect(heatScore(0.6)).toBeCloseTo(0.8);
    expect(heatScore(0.5 - HEAT.zoneHalf)).toBeCloseTo(1 - HEAT.zoneHalf * 2);
    expect(heatScore(0.5 + HEAT.zoneHalf + 0.01)).toBe(HEAT.missScore);
  });

  it('swings the needle across 0..1', () => {
    expect(needlePos(0)).toBeCloseTo(0.5);
    for (let t = 0; t < 10; t += 0.07) {
      const p = needlePos(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe('blow', () => {
  it('gives full marks on target and the pop penalty after a burst', () => {
    expect(blowScore(230, 230, 0)).toBe(1);
    expect(blowScore(230, 230, 1)).toBeCloseTo(0.7);
  });

  it('never drops below 0.1 before the penalty', () => {
    expect(blowScore(0, 230, 0)).toBe(0.1);
    expect(blowScore(1000, 150, 0)).toBe(0.1);
    expect(blowScore(0, 150, 2)).toBeCloseTo(0.1 * BLOW.popPenalty);
  });

  it('pops above 130 % of the target only', () => {
    expect(popped(300, 230)).toBe(true);
    expect(popped(230 * 1.3, 230)).toBe(false);
    expect(popped(BLOW.target.maly * 1.31, BLOW.target.maly)).toBe(true);
  });
});

describe('scoring', () => {
  it('turns a perfect order into 3 stars and a bad one into 1', () => {
    expect(starsFor(orderScore({ heat: 1, blow: 1, mineralOk: true, shapeOk: true }))).toBe(3);
    expect(starsFor(orderScore({ heat: 0.15, blow: 0.1, mineralOk: false, shapeOk: true }))).toBe(1);
  });

  it('uses the 3.3 / 2.1 thresholds', () => {
    expect(starsFor(3.3)).toBe(3);
    expect(starsFor(3.29)).toBe(2);
    expect(starsFor(2.1)).toBe(2);
    expect(starsFor(2.09)).toBe(1);
    expect(orderScore({ heat: 0.5, blow: 0.25, mineralOk: true, shapeOk: false })).toBeCloseTo(1.75);
  });

  it('names the shift from the 9-star total', () => {
    expect(summaryTitle(9)).toBe('master');
    expect(summaryTitle(8)).toBe('master');
    expect(summaryTitle(7)).toBe('glassblower');
    expect(summaryTitle(5)).toBe('glassblower');
    expect(summaryTitle(4)).toBe('apprentice');
    expect(summaryTitle(3)).toBe('apprentice');
  });

  it('maps stars to the customer reaction', () => {
    expect(reactionKey(3)).toBe('ok');
    expect(reactionKey(2)).toBe('meh');
    expect(reactionKey(1)).toBe('bad');
  });

  it('saves the title tier as 1..3 stars', () => {
    expect(saveStars(9)).toBe(3);
    expect(saveStars(6)).toBe(2);
    expect(saveStars(3)).toBe(1);
  });
});

describe('orders', () => {
  it('picks 3 different customers', () => {
    const orders = pickOrders(mulberry32(1));
    expect(orders).toHaveLength(3);
    expect(new Set(orders.map((o) => o.id)).size).toBe(3);
  });

  it('is deterministic per seed and leaves CUSTOMERS untouched', () => {
    const before = CUSTOMERS.map((c) => c.id);
    expect(pickOrders(mulberry32(5)).map((c) => c.id)).toEqual(pickOrders(mulberry32(5)).map((c) => c.id));
    expect(CUSTOMERS.map((c) => c.id)).toEqual(before);
  });

  it('asks only for known shapes and minerals', () => {
    const minerals = MINERALS.map((m) => m.id);
    for (const c of CUSTOMERS) {
      expect(SHAPES).toContain(c.shape);
      expect(minerals).toContain(c.mineral);
    }
  });
});

describe('notes', () => {
  const order = CUSTOMERS[0];

  it('says nothing about a perfect vessel', () => {
    expect(noteKeys(order, { heat: 1, blow: 1, mineral: order.mineral, shape: order.shape })).toEqual([]);
  });

  it('lists colour, shape, size and heat in that order', () => {
    expect(noteKeys(order, { heat: 0.15, blow: 0.1, mineral: 'uran', shape: 'kula' })).toEqual([
      'color',
      'shape',
      'size',
      'heat',
    ]);
  });
});

it('gives every step a time limit', () => {
  expect(LIMITS).toEqual({ heat: 12, blow: 20, color: 15, shape: 15 });
});
