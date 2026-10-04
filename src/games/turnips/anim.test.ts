import { describe, expect, it } from 'vitest';
import { Clock, easeInBack, easeOutBack, linear } from './anim';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('Clock', () => {
  it('steps a tween with the scene dt and ends exactly on 1', async () => {
    const clock = new Clock();
    const seen: number[] = [];
    let done = false;
    void clock.tween(1, (k) => seen.push(k), linear).then(() => (done = true));
    clock.update(0.25);
    clock.update(0.5);
    await flush();
    expect(done).toBe(false);
    clock.update(0.5);
    await flush();
    expect(seen).toEqual([0.25, 0.75, 1]);
    expect(done).toBe(true);
  });

  it('resolves a wait once its seconds have passed', async () => {
    const clock = new Clock();
    let done = false;
    void clock.wait(0.3).then(() => (done = true));
    clock.update(0.2);
    await flush();
    expect(done).toBe(false);
    clock.update(0.1);
    await flush();
    expect(done).toBe(true);
  });

  it('cancel(owner) drops only that owner; its promise never settles', async () => {
    const clock = new Clock();
    const owner = {};
    let cancelled = false;
    let kept = false;
    void clock.wait(0.1, owner).then(() => (cancelled = true));
    void clock.wait(0.1).then(() => (kept = true));
    clock.cancel(owner);
    clock.update(1);
    await flush();
    expect(cancelled).toBe(false);
    expect(kept).toBe(true);
  });

  it('clear() stops everything, so awaiting code never resumes after a scene exits', async () => {
    const clock = new Clock();
    let resumed = false;
    void (async () => {
      await clock.wait(0.1);
      resumed = true;
    })();
    clock.clear();
    clock.update(1);
    await flush();
    expect(resumed).toBe(false);
  });

  it('runs jobs added during an update from the next frame on', async () => {
    const clock = new Clock();
    const seen: number[] = [];
    void clock.wait(0.1).then(() => clock.tween(0.2, (k) => seen.push(k)));
    clock.update(0.1);
    await flush();
    expect(seen).toEqual([]);
    clock.update(0.1);
    expect(seen).toEqual([0.5]);
  });
});

describe('easings', () => {
  it('start at 0, end at 1; back easings overshoot', () => {
    for (const e of [linear, easeOutBack, easeInBack]) {
      expect(e(0)).toBeCloseTo(0);
      expect(e(1)).toBeCloseTo(1);
    }
    expect(easeOutBack(0.6)).toBeGreaterThan(1);
    expect(easeInBack(0.2)).toBeLessThan(0);
  });
});
