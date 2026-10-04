import { it, expect, vi, afterEach } from 'vitest';

// jsdom has no canvas: Pixi probes one on import, and Text measures itself with one.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { CanvasTextMetrics, type FederatedPointerEvent } from 'pixi.js';
import { Button } from './Button';
import { HoldButton } from './HoldButton';

vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
  (text = ' ') => ({ width: String(text).length * 10, height: 30 }) as unknown as CanvasTextMetrics,
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
    (text = ' ') => ({ width: String(text).length * 10, height: 30 }) as unknown as CanvasTextMetrics,
  );
});

/** A Pixi pointer event as the button sees it; `target` is the canvas the native event hit. */
function ev(pointerId = 1, target: EventTarget | null = null): FederatedPointerEvent {
  return { pointerId, nativeEvent: { pointerId, target } } as unknown as FederatedPointerEvent;
}

function nativeCancel(pointerId: number): Event {
  return Object.assign(new Event('pointercancel'), { pointerId });
}

function holdButton() {
  const b = new HoldButton('Blow');
  const start = vi.fn();
  const end = vi.fn();
  b.onHoldStart = start;
  b.onHoldEnd = end;
  return { b, start, end };
}

it('fires onTap on pointerdown and onPress on release over the button', () => {
  const onTap = vi.fn();
  const onPress = vi.fn();
  const b = new Button('Go', { onTap, onPress });
  b.emit('pointerdown', ev());
  expect(onTap).toHaveBeenCalledTimes(1);
  expect(onPress).not.toHaveBeenCalled();
  b.emit('pointerup', ev());
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('only resets when the press is released outside', () => {
  const onPress = vi.fn();
  const b = new Button('Go', { onPress });
  b.emit('pointerdown', ev());
  b.emit('pointerupoutside', ev());
  b.emit('pointerup', ev());
  expect(onPress).not.toHaveBeenCalled();
});

it('ignores presses while disabled', () => {
  const onPress = vi.fn();
  const onTap = vi.fn();
  const b = new Button('Go', { onPress, onTap });
  b.enabled = false;
  b.emit('pointerdown', ev());
  b.emit('pointerup', ev());
  expect(onTap).not.toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();
});

it('is not locked by a press whose pointerup never came', () => {
  const onPress = vi.fn();
  const b = new Button('Go', { onPress });
  b.emit('pointerdown', ev(1));
  b.emit('pointerdown', ev(2));
  b.emit('pointerup', ev(2));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('grows the hit area of a small kiosk button to 96 px', () => {
  const b = new Button('', { width: 40, height: 40, kiosk: true });
  expect(b.hitArea).toMatchObject({ x: -28, y: -28, width: 96, height: 96 });
});

it('registers a named button for the dev smoke tests and forgets it on destroy', () => {
  const b = new Button('Go', { name: 'test.go' });
  b.position.set(100, 50);
  const { w, h } = b.box;
  expect(window.__bk?.buttons?.['test.go']()).toEqual({ x: 100 + w / 2, y: 50 + h / 2 });
  b.destroy();
  expect(window.__bk?.buttons?.['test.go']).toBeUndefined();
});

it('holds from pointerdown until pointerup', () => {
  const { b, start, end } = holdButton();
  b.emit('pointerdown', ev());
  expect(b.holding).toBe(true);
  expect(start).toHaveBeenCalledTimes(1);
  b.emit('pointerup', ev());
  expect(b.holding).toBe(false);
  expect(end).toHaveBeenCalledTimes(1);
});

it.each(['pointerupoutside', 'pointercancel'] as const)('ends the hold on %s', (type) => {
  const { b, end } = holdButton();
  b.emit('pointerdown', ev());
  b.emit(type, ev());
  expect(b.holding).toBe(false);
  expect(end).toHaveBeenCalledTimes(1);
});

it("ends the hold on the browser's own pointercancel for that pointer only", () => {
  const { b, end } = holdButton();
  b.emit('pointerdown', ev(7));
  window.dispatchEvent(nativeCancel(8));
  expect(b.holding).toBe(true);
  window.dispatchEvent(nativeCancel(7));
  expect(b.holding).toBe(false);
  expect(end).toHaveBeenCalledTimes(1);
  b.destroy();
});

it('ends the hold when the window loses focus', () => {
  const { b, end } = holdButton();
  b.emit('pointerdown', ev());
  window.dispatchEvent(new Event('blur'));
  expect(b.holding).toBe(false);
  expect(end).toHaveBeenCalledTimes(1);
  b.destroy();
});

it('ends the hold when the button gets disabled', () => {
  const { b, end } = holdButton();
  b.emit('pointerdown', ev());
  b.enabled = false;
  expect(b.holding).toBe(false);
  expect(end).toHaveBeenCalledTimes(1);
});

it('restarts the hold for a second finger instead of stacking holds', () => {
  const { b, start, end } = holdButton();
  b.emit('pointerdown', ev(1));
  b.emit('pointerdown', ev(2));
  expect(start).toHaveBeenCalledTimes(2);
  expect(end).toHaveBeenCalledTimes(1);
  b.emit('pointerup', ev(1));
  expect(b.holding).toBe(true);
  b.emit('pointerup', ev(2));
  expect(b.holding).toBe(false);
  expect(end).toHaveBeenCalledTimes(2);
});

it('captures the pointer to the canvas while holding', () => {
  const canvas = document.createElement('canvas');
  const capture = Object.assign(canvas, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  });
  const { b } = holdButton();
  b.emit('pointerdown', ev(3, canvas));
  expect(capture.setPointerCapture).toHaveBeenCalledWith(3);
  b.emit('pointerupoutside', ev(3, canvas));
  expect(capture.releasePointerCapture).toHaveBeenCalledWith(3);
});

it('removes its window listeners on destroy, without calling onHoldEnd', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const { b, end } = holdButton();
  const added = add.mock.calls.filter(([type]) => type === 'blur' || type === 'pointercancel');
  expect(added).toHaveLength(2);
  b.emit('pointerdown', ev());
  b.destroy();
  for (const [type, listener] of added) expect(remove).toHaveBeenCalledWith(type, listener, ...(type === 'pointercancel' ? [true] : []));
  window.dispatchEvent(new Event('blur'));
  expect(end).not.toHaveBeenCalled();
});
