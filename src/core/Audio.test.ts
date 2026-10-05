import { it, expect, beforeEach, vi } from 'vitest';

// Fake Howler: records what each Howl was created with, the per-sound settings it received and which
// sounds are sounding. A Howl starts loaded unless FakeHowl.startLoaded is false; then it loads when
// the test calls finishLoad().
const { FakeHowl } = vi.hoisted(() => {
  interface Options {
    src: string[];
    onload?: () => void;
    onplay?: (id: number) => void;
    onend?: (id: number) => void;
  }

  class FakeHowl {
    static instances: FakeHowl[] = [];
    static startLoaded = true;
    readonly volumes = new Map<number, number>();
    readonly loops = new Map<number, boolean>();
    readonly rates = new Map<number, number>();
    /** Sound id → sounding now. */
    readonly sounds = new Map<number, boolean>();
    /** Calls to play(), loaded or not. */
    plays = 0;
    private loadState: 'loading' | 'loaded';
    private readonly queued: number[] = [];
    private nextId = 1;

    constructor(readonly options: Options) {
      this.loadState = FakeHowl.startLoaded ? 'loaded' : 'loading';
      FakeHowl.instances.push(this);
    }

    /** Like Howler, a play() before the load is queued and starts once the clip has loaded. */
    play(): number {
      const id = this.nextId++;
      this.plays++;
      if (this.loadState === 'loaded') this.sounds.set(id, true);
      else this.queued.push(id);
      return id;
    }

    /**
     * A stop() before the load is lost: Howler only queues it behind the plays, and its queue stalls
     * on a task that never fires its event. Audio must not rely on it.
     */
    stop(id?: number): this {
      if (this.loadState !== 'loaded') return this;
      for (const sound of this.sounds.keys()) if (id === undefined || id === sound) this.sounds.set(sound, false);
      return this;
    }

    finishLoad(): void {
      this.loadState = 'loaded';
      for (const id of this.queued.splice(0)) this.sounds.set(id, true);
      this.options.onload?.();
    }

    /** Howler starting a sound it held back (until the AudioContext resumed), whatever was asked since. */
    startLate(id: number): void {
      this.sounds.set(id, true);
      this.options.onplay?.(id);
    }

    end(id: number): void {
      this.sounds.set(id, false);
      this.options.onend?.(id);
    }

    state(): 'loading' | 'loaded' {
      return this.loadState;
    }

    playing(id?: number): boolean {
      return id === undefined ? [...this.sounds.values()].some(Boolean) : this.sounds.get(id) === true;
    }

    /** Ids sounding now. */
    get sounding(): number[] {
      return [...this.sounds].filter(([, on]) => on).map(([id]) => id);
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
  }
  return { FakeHowl };
});
vi.mock('howler', () => ({ Howl: FakeHowl, Howler: { mute: () => {} } }));

import { Audio } from './Audio';

beforeEach(() => {
  localStorage.clear();
  FakeHowl.instances = [];
  FakeHowl.startLoaded = true;
});

/** The hub's and the turnips game's ambience share one clip, like hub.wind / turnips.wind. */
function sceneAudio(): Audio {
  return new Audio(
    {
      'hub.music': ['music/hub'],
      'hub.wind': ['turnips/wind'],
      'turnips.wind': ['turnips/wind'],
      'ui.tap': ['ui/tap'],
    },
    'assets/audio/',
    new Set(['music/hub', 'turnips/wind', 'ui/tap']),
  );
}

function howlOf(src: string): InstanceType<typeof FakeHowl> {
  const howl = FakeHowl.instances.find((h) => h.options.src[0] === `assets/audio/${src}.mp3`);
  if (!howl) throw new Error(`no Howl for ${src}`);
  return howl;
}

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

it('stops the clip a moment resolves to, and stopAll() everything', () => {
  const a = sceneAudio();
  a.play('hub.music', { loop: true });
  a.play('hub.wind', { loop: true });
  a.stop('hub.music');
  expect(howlOf('music/hub').playing()).toBe(false);
  expect(howlOf('turnips/wind').playing()).toBe(true);
  a.stopAll();
  expect(howlOf('turnips/wind').playing()).toBe(false);
});

it('waits for a loading clip and then plays it with its own settings', () => {
  FakeHowl.startLoaded = false;
  const a = sceneAudio();
  expect(a.play('hub.music', { loop: true, volume: 0.5 })).toBeUndefined();
  const howl = howlOf('music/hub');
  expect(howl.plays).toBe(0);

  howl.finishLoad();
  expect(howl.sounding).toHaveLength(1);
  const [id] = howl.sounding;
  expect(howl.loops.get(id)).toBe(true);
  expect(howl.volumes.get(id)).toBe(0.5);
});

it('stop() before the clip has loaded: nothing plays once it loads', () => {
  // the hub: a tap on a marker starts the music (pointerdown) and leaves the hub (pointertap)
  FakeHowl.startLoaded = false;
  const a = sceneAudio();
  a.play('hub.music', { loop: true, volume: 0.5 });
  a.play('hub.wind', { loop: true, volume: 0.25 });
  a.stop('hub.music');
  a.stop('hub.wind');

  howlOf('music/hub').finishLoad();
  howlOf('turnips/wind').finishLoad();
  expect(howlOf('music/hub').playing()).toBe(false);
  expect(howlOf('turnips/wind').playing()).toBe(false);
  expect(howlOf('music/hub').plays).toBe(0);
});

it('stopAll() before the clips have loaded: nothing plays once they load', () => {
  FakeHowl.startLoaded = false;
  const a = sceneAudio();
  a.play('hub.music', { loop: true });
  a.play('hub.wind', { loop: true });
  a.stopAll();

  for (const howl of FakeHowl.instances) howl.finishLoad();
  expect(FakeHowl.instances.some((h) => h.playing())).toBe(false);
});

it('a moment started after stopAll() still plays, on a clip shared with the stopped one', () => {
  FakeHowl.startLoaded = false;
  const a = sceneAudio();
  a.play('hub.wind', { loop: true, volume: 0.25 });
  a.stopAll();
  a.play('turnips.wind', { loop: true, volume: 0.3 });

  const wind = howlOf('turnips/wind');
  wind.finishLoad();
  expect(wind.sounding).toHaveLength(1);
  expect(wind.volumes.get(wind.sounding[0])).toBe(0.3);

  // and once the clip is loaded, the same goes for a sound started right after a stopAll()
  a.stopAll();
  a.play('turnips.wind', { loop: true, volume: 0.3 });
  expect(wind.sounding).toHaveLength(1);
});

it('stopAll({ keepOneShots }) stops loops, playing or waiting, and lets a sounding one-shot ring out', () => {
  const a = sceneAudio();
  a.play('hub.music', { loop: true });
  const tap = a.play('ui.tap')!;
  FakeHowl.startLoaded = false;
  a.play('hub.wind', { loop: true });

  a.stopAll({ keepOneShots: true });
  expect(howlOf('music/hub').playing()).toBe(false);
  expect(howlOf('ui/tap').playing(tap)).toBe(true);
  howlOf('turnips/wind').finishLoad();
  expect(howlOf('turnips/wind').playing()).toBe(false);
});

it('stopAll({ keepOneShots }) keeps a one-shot that waits for its clip', () => {
  FakeHowl.startLoaded = false;
  const a = sceneAudio();
  a.play('ui.tap');
  a.stopAll({ keepOneShots: true });
  howlOf('ui/tap').finishLoad();
  expect(howlOf('ui/tap').playing()).toBe(true);
});

it('stops a sound again when Howler starts it after it was stopped', () => {
  const a = sceneAudio();
  const id = a.play('hub.music', { loop: true })!;
  const howl = howlOf('music/hub');
  // Howler held the start back (AudioContext suspended), so the stop found nothing to stop yet
  howl.sounds.set(id, false);
  a.stop('hub.music');
  howl.startLate(id);
  expect(howl.playing(id)).toBe(false);

  // a sound still wanted is left alone when Howler (re)starts it, as on every loop round
  const kept = a.play('hub.music', { loop: true })!;
  howl.startLate(kept);
  expect(howl.playing(kept)).toBe(true);
});

it('stops sounds by id, and forgets a one-shot once it has ended', () => {
  const a = sceneAudio();
  const wind = a.play('turnips.wind', { loop: true })!;
  const howl = howlOf('turnips/wind');
  const gust = a.play('hub.wind')!;
  howl.end(gust);
  const stop = vi.spyOn(howl, 'stop');
  a.stopAll();
  // never stop() without an id: Howler may defer it, and then it would hit sounds started later
  expect(stop.mock.calls).toEqual([[wind]]);
  expect(howl.playing()).toBe(false);
});
