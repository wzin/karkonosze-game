import { Howl, Howler } from 'howler';

/** A named game moment ("glass.blow", "ui.tap"); MOMENTS in ./moments maps it to candidate clips. */
export type Moment = string;

export interface PlayOptions {
  loop?: boolean;
  volume?: number;
  rate?: number;
}

export interface StopAllOptions {
  /**
   * Stop loops only: one-shots already sounding, or waiting for their clip, ring out. A scene change
   * uses it, so the tap on the button that changed the scene is not cut off.
   */
  keepOneShots?: boolean;
}

/** Dev-only snapshot of one clip, read by `window.__bk.audio()`. */
export interface ClipDebug {
  src: string;
  state: 'unloaded' | 'loading' | 'loaded';
  /** Howler's own answer: some sound of this clip is playing. */
  playing: boolean;
  /** A looping sound of this clip is playing. */
  loop: boolean;
  /** Plays waiting for the clip to load. */
  waiting: number;
}

/** One clip: its Howl, the sounds this Audio started on it and the plays waiting for it to load. */
interface Clip {
  howl: Howl;
  /** Sounds started and not stopped yet, by Howler sound id, with their loop flag. */
  live: Map<number, boolean>;
  /** Plays asked for while the clip loads: started on load unless a stop drops them first. */
  waiting: PlayOptions[];
}

const MUTED_KEY = 'bk.muted';

export interface AudioOptions {
  /**
   * Remember the mute flag in localStorage (default true). The kiosk passes false: one child's tap on
   * the speaker must not silence the installation for every visitor after; see resetMute().
   */
  persist?: boolean;
}

/**
 * Plays moments through Howler. A moment resolves to its first candidate clip present in `available`
 * (the audio manifest), so missing clips fall through to generic ones or play nothing at all.
 *
 * Plays never go into Howler's load queue. A Howl that is still loading queues play() and stop() and
 * runs them one by one, each only after the previous one fires its event: a stop() queued behind a
 * play that never fires 'play' (or behind a volume() Howler re-queued) never runs, and the loop plays
 * on into the next scene. So a play waits here until its clip has loaded and a stop drops it; a sound
 * Howler starts after it was stopped (a start held back until the AudioContext resumes) is stopped
 * again the moment it starts.
 */
export class Audio {
  private readonly clips = new Map<string, Clip>();
  private readonly persist: boolean;
  private isMuted: boolean;

  constructor(
    private readonly moments: Record<Moment, string[]>,
    private readonly baseUrl = 'assets/audio/',
    private readonly available: Set<string>,
    opts: AudioOptions = {},
  ) {
    this.persist = opts.persist ?? true;
    this.isMuted = this.persist ? readMuted() : false;
    Howler.mute(this.isMuted);
    if (import.meta.env.DEV) {
      const bk = (window.__bk ??= { sceneId: null });
      bk.audio = () => this.debug();
    }
  }

  /**
   * Settings apply to this sound id only: a clip shared by several moments keeps no caller's options.
   * Returns the Howler sound id, or undefined when nothing plays yet (no clip, or it is still loading).
   */
  play(moment: Moment, opts: PlayOptions = {}): number | undefined {
    const name = this.resolve(moment);
    if (!name) return undefined;
    const clip = this.clip(name);
    if (clip.howl.state() !== 'loaded') {
      clip.waiting.push(opts);
      return undefined;
    }
    return this.start(clip, opts);
  }

  /** Stops every sound of the clip the moment resolves to and drops its plays waiting for the load. */
  stop(moment: Moment): void {
    const name = this.resolve(moment);
    const clip = name ? this.clips.get(name) : undefined;
    if (clip) this.silence(clip, () => true);
  }

  stopAll(opts: StopAllOptions = {}): void {
    const stops = opts.keepOneShots ? (loop: boolean) => loop : () => true;
    for (const clip of this.clips.values()) this.silence(clip, stops);
  }

  setMuted(m: boolean): void {
    this.isMuted = m;
    Howler.mute(m);
    if (!this.persist) return;
    try {
      localStorage.setItem(MUTED_KEY, m ? '1' : '0');
    } catch {
      // storage unavailable: the flag lasts for this visit only
    }
  }

  /** Sound back on for the next visitor (the kiosk calls it when the idle timer returns to the hub). */
  resetMute(): void {
    this.setMuted(false);
  }

  get muted(): boolean {
    return this.isMuted;
  }

  resolve(moment: Moment): string | null {
    return this.moments[moment]?.find((name) => this.available.has(name)) ?? null;
  }

  private start(clip: Clip, opts: PlayOptions): number {
    const { howl } = clip;
    const loop = opts.loop ?? false;
    const id = howl.play();
    howl.volume(opts.volume ?? 1, id);
    howl.loop(loop, id);
    howl.rate(opts.rate ?? 1, id);
    clip.live.set(id, loop);
    return id;
  }

  /** Stops the clip's live sounds whose loop flag `stops` picks, and drops its waiting plays alike. */
  private silence(clip: Clip, stops: (loop: boolean) => boolean): void {
    clip.waiting = clip.waiting.filter((o) => !stops(o.loop ?? false));
    for (const [id, loop] of clip.live) {
      if (!stops(loop)) continue;
      clip.live.delete(id);
      // by id, never the whole Howl: a stop Howler defers must not catch a sound started after it
      clip.howl.stop(id);
    }
  }

  /** One lazily created Howl per clip, shared by every moment that resolves to it. */
  private clip(name: string): Clip {
    const known = this.clips.get(name);
    if (known) return known;
    const clip: Clip = { live: new Map(), waiting: [], howl: null as unknown as Howl };
    clip.howl = new Howl({
      src: [`${this.baseUrl}${name}.mp3`],
      onload: () => {
        const waiting = clip.waiting;
        clip.waiting = [];
        for (const opts of waiting) this.start(clip, opts);
      },
      onloaderror: (_id, err) => {
        clip.waiting = [];
        console.warn(`[audio] failed to load "${name}"`, err);
      },
      // a sound stopped before Howler really started it starts later: stop it again right then
      onplay: (id) => {
        if (!clip.live.has(id)) clip.howl.stop(id);
      },
      onend: (id) => {
        if (clip.live.get(id) === false) clip.live.delete(id);
      },
    });
    this.clips.set(name, clip);
    return clip;
  }

  private debug(): ClipDebug[] {
    return [...this.clips].map(([src, { howl, live, waiting }]) => ({
      src,
      state: howl.state(),
      playing: howl.playing(),
      loop: [...live].some(([id, loop]) => loop && howl.playing(id)),
      waiting: waiting.length,
    }));
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}
