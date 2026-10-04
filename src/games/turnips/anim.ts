/** Maps linear progress 0..1 to eased progress (0 → 0, 1 → 1). */
export type Ease = (t: number) => number;

const BACK = 1.70158;

export const linear: Ease = (t) => t;
/** Overshoots past 1 and settles back: a springy pop. */
export const easeOutBack: Ease = (t) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2;
/** Dips below 0 first, then rushes to 1: a duck before the drop. */
export const easeInBack: Ease = (t) => (BACK + 1) * t ** 3 - BACK * t ** 2;
export const easeOutCubic: Ease = (t) => 1 - (1 - t) ** 3;
export const easeInOutSine: Ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

interface Job {
  elapsed: number;
  duration: number;
  step: ((k: number) => void) | null;
  ease: Ease;
  done: () => void;
  owner: object | null;
}

/**
 * Tweens and waits on the scene's own clock: update(dt) drives them, so they pause with the scene's
 * ticker and use its capped dt. cancel(owner) and clear() drop jobs without settling their promises,
 * so code awaiting them simply never resumes (that is how a scene's async flow stops on exit).
 */
export class Clock {
  private jobs: Job[] = [];

  /** Calls step(ease(k)) every frame for `seconds`, the last call with k = 1; resolves after it. */
  tween(seconds: number, step: (k: number) => void, ease: Ease = linear, owner: object | null = null): Promise<void> {
    return new Promise((done) => {
      this.jobs.push({ elapsed: 0, duration: Math.max(seconds, 0), step, ease, done, owner });
    });
  }

  wait(seconds: number, owner: object | null = null): Promise<void> {
    return new Promise((done) => {
      this.jobs.push({ elapsed: 0, duration: Math.max(seconds, 0), step: null, ease: linear, done, owner });
    });
  }

  cancel(owner: object): void {
    this.jobs = this.jobs.filter((j) => j.owner !== owner);
  }

  clear(): void {
    this.jobs = [];
  }

  update(dt: number): void {
    // jobs added by the callbacks below start on the next frame
    const running = this.jobs;
    const finished = new Set<Job>();
    for (const job of running) {
      if (!this.jobs.includes(job)) continue; // cancelled by an earlier callback this frame
      job.elapsed += dt;
      const k = job.duration === 0 ? 1 : Math.min(job.elapsed / job.duration, 1);
      job.step?.(job.ease(k));
      if (k >= 1) finished.add(job);
    }
    if (finished.size === 0) return;
    this.jobs = this.jobs.filter((j) => !finished.has(j));
    for (const job of finished) job.done();
  }
}
