import { it, expect, vi } from 'vitest';

// jsdom has no canvas: Pixi probes one on import.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { Container, Ticker } from 'pixi.js';
import type { Audio } from './Audio';
import { Scene, type SceneContext } from './Scene';
import { SceneManager } from './SceneManager';

class Logged extends Scene {
  constructor(
    ctx: SceneContext,
    private readonly tag: string,
    private readonly log: string[],
  ) {
    super(ctx);
  }

  override async init(): Promise<void> {
    this.log.push(`${this.tag}.init`);
  }

  override enter(): void {
    this.log.push(`${this.tag}.enter`);
  }

  override exit(): void {
    this.log.push(`${this.tag}.exit`);
  }
}

it("stops the old scene's loops after its exit() and before the next scene's init() and enter()", async () => {
  const log: string[] = [];
  const audio: Pick<Audio, 'stopAll'> = { stopAll: (opts) => void log.push(`stopAll ${JSON.stringify(opts)}`) };
  const scenes = new SceneManager(new Container(), new Ticker());
  scenes.setContext({ audio } as unknown as SceneContext);
  scenes.register('hub', (c) => new Logged(c, 'hub', log));
  scenes.register('game:turnips', (c) => new Logged(c, 'turnips', log));

  await scenes.go('hub');
  log.length = 0;
  await scenes.go('game:turnips');
  expect(log).toEqual(['hub.exit', 'stopAll {"keepOneShots":true}', 'turnips.init', 'turnips.enter']);
});
