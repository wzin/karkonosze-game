import { Container } from 'pixi.js';
import type { SceneContext } from '../../../core/Scene';
import { Tweens, type ParticleLayer } from '../fx';
import type { Customer } from '../rules';
import type { InstructionCard, Toast } from '../ui';
import type { Workpiece } from '../Workpiece';

/** What a step may touch in the scene. */
export interface StepEnv {
  ctx: SceneContext;
  t: (key: string, vars?: Record<string, string | number>) => string;
  order: Customer;
  /** 0-based index of the order in this game. */
  index: number;
  piece: Workpiece;
  /** Particles that may outlive the step (shards, pigment, steam). */
  fx: ParticleLayer;
  card: InstructionCard;
  toast: Toast;
  /** Finished vessels stand here, in scene space. */
  table: Container;
  rng: () => number;
}

/**
 * One move of an order (heat, blow, colour, shape) or its result card. Shared API:
 * mount(parent) → update(dt) every frame → unmount(). A step with a `limit` runs the time bar on the
 * instruction card and calls timeUp() when it runs out, so the game never stalls.
 */
export abstract class Step extends Container {
  /** Which move this is ('heat', 'blow', 'colour', 'shape', 'result'); read by the dev hook. */
  abstract readonly kind: string;
  protected readonly tw = new Tweens();
  private elapsed = 0;
  private clockOn = false;

  constructor(
    protected readonly env: StepEnv,
    private readonly limit: number | null,
  ) {
    super();
  }

  mount(parent: Container): void {
    parent.addChild(this);
    this.clockOn = this.limit !== null;
    this.env.card.setTime(this.clockOn ? 1 : null);
    this.start();
  }

  unmount(): void {
    this.tw.clear();
    this.clockOn = false;
    this.removeFromParent();
    this.destroy({ children: true });
  }

  update(dt: number): void {
    if (this.destroyed) return;
    this.tw.update(dt);
    if (this.destroyed) return;
    if (this.clockOn && this.limit !== null) {
      this.elapsed += dt;
      this.env.card.setTime(1 - this.elapsed / this.limit);
      if (this.elapsed >= this.limit) {
        this.stopClock();
        this.timeUp();
        if (this.destroyed) return;
      }
    }
    this.tick(dt);
  }

  /** Dev-only snapshot of the step's live values (needle, radius…) for the smoke test. */
  debug(): Record<string, number | string> {
    return {};
  }

  /** The player has acted: freeze the time bar where it is. */
  protected stopClock(): void {
    this.clockOn = false;
  }

  protected abstract start(): void;

  /** The limit ran out: resolve with the current (or the worst) value. */
  protected timeUp(): void {}

  protected tick(_dt: number): void {}
}
