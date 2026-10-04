import { Container, type Application } from 'pixi.js';
import type { AssetRegistry } from './Assets';
import type { Audio } from './Audio';
import type { I18n } from './I18n';
import type { Save } from './Save';

export interface SceneContext {
  app: Application;
  assets: AssetRegistry;
  audio: Audio;
  save: Save;
  i18n: I18n;
  kiosk: boolean;
  /** 'hub' | 'game:<gameId>' */
  go(sceneId: string, params?: Record<string, string>): void;
}

/** A screen laid out in DESIGN space. Lifecycle: init (async, loader shown) → enter → update… → exit. */
export abstract class Scene extends Container {
  constructor(protected ctx: SceneContext) {
    super();
  }

  async init(_params: Record<string, string>): Promise<void> {}

  enter(): void {}

  /** @param _dt seconds since the last frame, capped at 0.1 */
  update(_dt: number): void {}

  exit(): void {}
}
