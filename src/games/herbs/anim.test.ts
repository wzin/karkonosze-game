import { expect, it, vi } from 'vitest';
import { Tweens } from './anim';

it('runs a tween from 0 to 1 over its duration, after its delay, then calls done once', () => {
  const tw = new Tweens();
  const seen: number[] = [];
  let done = 0;
  tw.add({ dur: 1, delay: 0.5, update: (p) => seen.push(p), done: () => done++ });
  tw.update(0.25);
  expect(seen).toEqual([]);
  tw.update(0.5);
  tw.update(0.5);
  tw.update(0.5);
  tw.update(0.5);
  expect(seen).toEqual([0.25, 0.75, 1]);
  expect(done).toBe(1);
});

it('fires after() once and keeps tweens added from a callback', () => {
  const tw = new Tweens();
  const log: string[] = [];
  tw.after(0.2, () => {
    log.push('a');
    tw.after(0.1, () => log.push('b'));
  });
  tw.update(0.1);
  tw.update(0.1);
  expect(log).toEqual(['a']);
  tw.update(0.1);
  tw.update(0.1);
  expect(log).toEqual(['a', 'b']);
});

it('drops everything still pending when a callback clears the list', () => {
  const tw = new Tweens();
  const log: string[] = [];
  tw.after(0.1, () => {
    log.push('clear');
    tw.clear();
  });
  tw.add({ dur: 1, update: () => log.push('tick') });
  tw.update(0.2);
  tw.update(0.2);
  expect(log).toEqual(['clear']);
});

it('drops a tween whose target is destroyed: no callback runs and nothing throws', () => {
  const tw = new Tweens();
  const target = { destroyed: false };
  const log: string[] = [];
  tw.add({ dur: 1, targets: [target], update: (p) => log.push(`u${p}`), done: () => log.push('done') });
  tw.after(0.5, () => log.push('after'), [target]);
  tw.update(0.25);
  target.destroyed = true;
  expect(() => {
    tw.update(0.5);
    tw.update(1);
  }).not.toThrow();
  expect(log).toEqual(['u0.25']);
});

it('skips a tween whose target was destroyed by an earlier tween in the same frame', () => {
  const tw = new Tweens();
  const target = { destroyed: false };
  const log: string[] = [];
  tw.after(0.1, () => (target.destroyed = true));
  tw.add({ dur: 1, targets: [target], update: () => log.push('touched') });
  tw.update(0.2);
  expect(log).toEqual([]);
});

it('keeps running when one tween throws: the bad one is dropped and logged', () => {
  const tw = new Tweens();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log: number[] = [];
  let calls = 0;
  tw.add({
    dur: 1,
    update: () => {
      calls++;
      throw new TypeError('destroyed');
    },
  });
  tw.add({ dur: 1, update: (p) => log.push(p) });
  expect(() => tw.update(0.5)).not.toThrow();
  tw.update(0.5);
  expect(calls).toBe(1);
  expect(log).toEqual([0.5, 1]);
  expect(errors).toHaveBeenCalledTimes(1);
  errors.mockRestore();
});
