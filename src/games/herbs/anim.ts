/** A timed animation step driven by the scene's update(dt); `p` runs 0 → 1 over `dur` seconds. */
export interface TweenSpec {
  dur: number;
  delay?: number;
  update: (p: number) => void;
  done?: () => void;
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

  /** Runs `fn` once after `seconds`. */
  after(seconds: number, fn: () => void): void {
    this.add({ dur: 0, delay: seconds, update: () => {}, done: fn });
  }

  update(dt: number): void {
    // tweens added by a callback land in the fresh list; clear() in a callback drops the rest
    const pass = this.list;
    this.list = [];
    const generation = this.generation;
    const keep: Running[] = [];
    for (const tw of pass) {
      if (generation !== this.generation) return;
      tw.t += dt;
      if (tw.t < 0) {
        keep.push(tw);
        continue;
      }
      const p = tw.dur > 0 ? Math.min(1, tw.t / tw.dur) : 1;
      tw.update(p);
      if (p < 1) keep.push(tw);
      else tw.done?.();
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
