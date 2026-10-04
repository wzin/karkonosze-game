/** Anything with Pixi's `destroyed` flag (every Container has one). */
export interface Destroyable {
  readonly destroyed: boolean;
}

/** A timed animation step driven by the scene's update(dt); `p` runs 0 → 1 over `dur` seconds. */
export interface TweenSpec {
  dur: number;
  delay?: number;
  update: (p: number) => void;
  done?: () => void;
  /**
   * Display objects the callbacks touch. Once any of them is destroyed (an overlay cleared by an
   * early tap, say) the tween is dropped without calling back, so it can never touch a dead object.
   */
  targets?: Destroyable[];
}

interface Running extends TweenSpec {
  t: number;
}

/** Tweens on the scene clock, so they pause and stop with the scene and never outlive it. */
export class Tweens {
  private list: Running[] = [];
  private generation = 0;

  add(spec: TweenSpec): void {
    this.list.push({ ...spec, t: -(spec.delay ?? 0) });
  }

  /** Runs `fn` once after `seconds`, unless one of `targets` is destroyed by then. */
  after(seconds: number, fn: () => void, targets?: Destroyable[]): void {
    this.add({ dur: 0, delay: seconds, update: () => {}, done: fn, targets });
  }

  /**
   * Advances every tween. Tweens added by a callback land in the fresh list; clear() in a callback
   * drops the rest. A callback that throws only loses its own tween: the error is logged and the
   * pass goes on, so one bad tween can never stop the ticker (Pixi's Ticker has no try/catch).
   */
  update(dt: number): void {
    const pass = this.list;
    this.list = [];
    const generation = this.generation;
    const keep: Running[] = [];
    for (const tw of pass) {
      if (generation !== this.generation) return;
      // checked per tween: an earlier callback in this very pass may have destroyed the target
      if (tw.targets?.some((t) => t.destroyed)) continue;
      tw.t += dt;
      if (tw.t < 0) {
        keep.push(tw);
        continue;
      }
      const p = tw.dur > 0 ? Math.min(1, tw.t / tw.dur) : 1;
      try {
        tw.update(p);
        if (p < 1) keep.push(tw);
        else tw.done?.();
      } catch (err) {
        console.error('[herbs] tween failed and was dropped', err);
      }
    }
    if (generation === this.generation) this.list = keep.concat(this.list);
  }

  clear(): void {
    this.list = [];
    this.generation++;
  }
}

export const ease = {
  outCubic: (p: number) => 1 - (1 - p) ** 3,
  inOutSine: (p: number) => 0.5 - Math.cos(Math.PI * p) / 2,
  /** Springy overshoot, like the UI kit's star pop. */
  outBack: (p: number) => {
    const c1 = 1.70158;
    return 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
  },
};

export function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}
