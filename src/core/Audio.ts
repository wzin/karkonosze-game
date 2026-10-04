import { Howl, Howler } from 'howler';

/** A named game moment ("glass.blow", "ui.tap"); the moments table maps it to candidate clips. */
export type Moment = string;

export interface PlayOptions {
  loop?: boolean;
  volume?: number;
  rate?: number;
}

const MUTED_KEY = 'bk.muted';

/**
 * Plays moments through Howler. A moment resolves to its first candidate clip present in `available`
 * (the audio manifest), so missing clips fall through to generic ones or play nothing at all.
 */
export class Audio {
  private readonly howls = new Map<string, Howl>();
  private isMuted: boolean;

  constructor(
    private readonly moments: Record<Moment, string[]>,
    private readonly baseUrl = '/assets/audio/',
    private readonly available: Set<string>,
  ) {
    this.isMuted = readMuted();
    Howler.mute(this.isMuted);
  }

  play(moment: Moment, opts: PlayOptions = {}): number | undefined {
    const name = this.resolve(moment);
    if (!name) return undefined;
    const howl = this.howl(name, opts);
    const id = howl.play();
    if (opts.rate !== undefined) howl.rate(opts.rate, id);
    return id;
  }

  stop(moment: Moment): void {
    const name = this.resolve(moment);
    if (name) this.howls.get(name)?.stop();
  }

  stopAll(): void {
    for (const howl of this.howls.values()) howl.stop();
  }

  setMuted(m: boolean): void {
    this.isMuted = m;
    Howler.mute(m);
    try {
      localStorage.setItem(MUTED_KEY, m ? '1' : '0');
    } catch {
      // storage unavailable: the flag lasts for this visit only
    }
  }

  get muted(): boolean {
    return this.isMuted;
  }

  resolve(moment: Moment): string | null {
    return this.moments[moment]?.find((name) => this.available.has(name)) ?? null;
  }

  /** One lazily created Howl per clip; loop and volume come from the first play() of that clip. */
  private howl(name: string, opts: PlayOptions): Howl {
    let howl = this.howls.get(name);
    if (!howl) {
      howl = new Howl({
        src: [`${this.baseUrl}${name}.mp3`],
        loop: opts.loop ?? false,
        volume: opts.volume ?? 1,
        onloaderror: (_id, err) => console.warn(`[audio] failed to load "${name}"`, err),
      });
      this.howls.set(name, howl);
    }
    return howl;
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}
