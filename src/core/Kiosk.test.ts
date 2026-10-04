import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleTimer } from './Kiosk';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('fires after the idle period and touch() postpones it', () => {
  const onIdle = vi.fn();
  const t = new IdleTimer(60, onIdle);
  t.start();
  vi.advanceTimersByTime(59_000);
  t.touch();
  vi.advanceTimersByTime(59_000);
  expect(onIdle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1_000);
  expect(onIdle).toHaveBeenCalledOnce();
});

it('does nothing when stopped, and touch() does not start it', () => {
  const onIdle = vi.fn();
  const t = new IdleTimer(1, onIdle);
  t.touch();
  t.start();
  t.stop();
  vi.advanceTimersByTime(5_000);
  expect(onIdle).not.toHaveBeenCalled();
});
