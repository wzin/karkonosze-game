import { it, expect, beforeEach, vi } from 'vitest';

// Fake Howler: records what each Howl was created with and the per-sound settings it received.
const { FakeHowl } = vi.hoisted(() => {
  class FakeHowl {
    static instances: FakeHowl[] = [];
    readonly volumes = new Map<number, number>();
    readonly loops = new Map<number, boolean>();
    readonly rates = new Map<number, number>();
    stopped = 0;
    private nextId = 1;

    constructor(readonly options: { src: string[] }) {
      FakeHowl.instances.push(this);
    }

    play(): number {
      return this.nextId++;
    }

    volume(v: number, id: number): this {
      this.volumes.set(id, v);
      return this;
    }

    loop(l: boolean, id: number): this {
      this.loops.set(id, l);
      return this;
    }

    rate(r: number, id: number): this {
      this.rates.set(id, r);
      return this;
    }

    stop(): this {
      this.stopped++;
      return this;
    }
  }
  return { FakeHowl };
});
vi.mock('howler', () => ({ Howl: FakeHowl, Howler: { mute: () => {} } }));

import { Audio } from './Audio';

beforeEach(() => {
  localStorage.clear();
  FakeHowl.instances = [];
});

it('resolves first available candidate', () => {
  const a = new Audio({ pop: ['glass/pop', 'ui/tap'] }, '/x/', new Set(['ui/tap']));
  expect(a.resolve('pop')).toBe('ui/tap');
  expect(a.resolve('nope')).toBeNull();
});

it('plays nothing when no candidate is available', () => {
  const a = new Audio({ pop: ['glass/pop'] }, '/x/', new Set());
  expect(a.play('pop')).toBeUndefined();
  expect(a.play('unknown')).toBeUndefined();
  expect(FakeHowl.instances).toHaveLength(0);
});

it('remembers the muted flag in localStorage', () => {
  const a = new Audio({}, undefined, new Set());
  expect(a.muted).toBe(false);
  a.setMuted(true);
  expect(localStorage.getItem('bk.muted')).toBe('1');
  expect(new Audio({}, undefined, new Set()).muted).toBe(true);
});

it('keeps a kiosk mute in memory only, without touching localStorage', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const a = new Audio({}, undefined, new Set(), { persist: false });
  a.setMuted(true);
  expect(a.muted).toBe(true);
  expect(setItem).not.toHaveBeenCalled();
  expect(localStorage.getItem('bk.muted')).toBeNull();
  setItem.mockRestore();
});

it('starts a kiosk unmuted whatever an earlier visit stored', () => {
  localStorage.setItem('bk.muted', '1');
  expect(new Audio({}, undefined, new Set(), { persist: false }).muted).toBe(false);
});

it('resetMute() unmutes for the next kiosk visitor', () => {
  const a = new Audio({}, undefined, new Set(), { persist: false });
  a.setMuted(true);
  a.resetMute();
  expect(a.muted).toBe(false);
  expect(localStorage.getItem('bk.muted')).toBeNull();
});

it('shares one Howl per clip but applies each play()s own volume, loop and rate', () => {
  const a = new Audio({ hum: ['ui/tap'], tap: ['ui/tap'] }, 'assets/audio/', new Set(['ui/tap']));
  const first = a.play('hum', { loop: true, volume: 0.3 });
  const second = a.play('tap', { volume: 0.9, rate: 1.5 });

  expect(FakeHowl.instances).toHaveLength(1);
  const howl = FakeHowl.instances[0];
  expect(howl.options.src).toEqual(['assets/audio/ui/tap.mp3']);
  expect(first).not.toBe(second);
  expect(howl.volumes.get(first!)).toBe(0.3);
  expect(howl.loops.get(first!)).toBe(true);
  expect(howl.rates.get(first!)).toBe(1);
  expect(howl.volumes.get(second!)).toBe(0.9);
  expect(howl.loops.get(second!)).toBe(false);
  expect(howl.rates.get(second!)).toBe(1.5);
});

it('stops the clip a moment resolves to', () => {
  const a = new Audio({ hum: ['ui/tap'] }, 'assets/audio/', new Set(['ui/tap']));
  a.play('hum');
  a.stop('hum');
  a.stopAll();
  expect(FakeHowl.instances[0].stopped).toBe(2);
});
