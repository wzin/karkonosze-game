import { expect, it } from 'vitest';
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
