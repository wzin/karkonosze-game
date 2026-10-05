import type { Container } from 'pixi.js';
import { DESIGN } from '../core/Layout';

/**
 * Largest shift (design px) of a layer with factor 1, and how fast the shift follows the pointer (1/s):
 * small and unhurried, so the panorama drifts rather than swings.
 */
export const PARALLAX = { amplitude: 30, rate: 2.5 } as const;

/** Parallax factors of the panorama layers; the sky stays put. */
export const DEPTH = { far: 0.15, mid: 0.3, valley: 0.5 } as const;
export type Depth = keyof typeof DEPTH;

export interface Vec {
  x: number;
  y: number;
}

/**
 * Shift for a pointer at (x, y) in design space: layers move against the pointer, by up to
 * `amplitude` when it reaches an edge (and no further beyond it).
 */
export function parallaxTarget(x: number, y: number, w: number = DESIGN.w, h: number = DESIGN.h, amplitude: number = PARALLAX.amplitude): Vec {
  const nx = clamp((x - w / 2) / (w / 2), -1, 1);
  const ny = clamp((y - h / 2) / (h / 2), -1, 1);
  // + 0 turns -0 into 0
  return { x: -nx * amplitude + 0, y: -ny * amplitude + 0 };
}

/** Exponential ease of `current` towards `target` at `rate` per second; frame-rate independent. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

interface Layer {
  view: Container;
  factor: number;
  home: Vec;
}

/** Eases a shared offset towards the pointer and moves each added layer by `offset × factor`. */
export class Parallax {
  readonly offset: Vec = { x: 0, y: 0 };
  private target: Vec = { x: 0, y: 0 };
  private readonly layers: Layer[] = [];

  /** The view's current position becomes its rest position. */
  add(view: Container, factor: number): void {
    this.layers.push({ view, factor, home: { x: view.x, y: view.y } });
  }

  /** Pointer position in design space. */
  pointAt(x: number, y: number): void {
    this.target = parallaxTarget(x, y);
  }

  /** Current shift of something that sits at `factor` depth. */
  shift(factor: number): Vec {
    return { x: this.offset.x * factor, y: this.offset.y * factor };
  }

  update(dt: number): void {
    this.offset.x = approach(this.offset.x, this.target.x, PARALLAX.rate, dt);
    this.offset.y = approach(this.offset.y, this.target.y, PARALLAX.rate, dt);
    for (const { view, factor, home } of this.layers) {
      view.position.set(home.x + this.offset.x * factor, home.y + this.offset.y * factor);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
