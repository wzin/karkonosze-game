import { Container, Graphics, Rectangle, type Ticker } from 'pixi.js';
import { DESIGN } from './Layout';
import type { Scene, SceneContext } from './Scene';

/** Sync factories build a scene directly; async ones may first import its code-split chunk. */
export type SceneFactory = (ctx: SceneContext) => Scene | Promise<Scene>;

const MAX_DT = 0.1;

/** Owns the active scene: switches scenes, shows a loader during init, drives update(dt). */
export class SceneManager {
  private readonly factories = new Map<string, SceneFactory>();
  private readonly loader = createLoader();
  private ctx: SceneContext | null = null;
  private current: Scene | null = null;
  private id: string | null = null;
  private navigation = 0;

  constructor(
    private readonly root: Container,
    ticker: Ticker,
    onActivity?: () => void,
  ) {
    root.addChild(this.loader);
    // the design-sized hit area lets every touch count as activity, even on empty background
    root.eventMode = 'static';
    root.hitArea = new Rectangle(0, 0, DESIGN.w, DESIGN.h);
    if (onActivity) root.on('pointerdown', onActivity);
    ticker.add((t) => {
      const dt = Math.min(t.deltaMS / 1000, MAX_DT);
      if (this.loader.visible) this.loader.rotation += dt * 6;
      this.current?.update(dt);
    });
    this.publish();
  }

  /** The context handed to every scene factory; main.ts sets it once it can build `go`. */
  setContext(ctx: SceneContext): void {
    this.ctx = ctx;
  }

  register(id: string, factory: SceneFactory): void {
    this.factories.set(id, factory);
  }

  async go(id: string, params: Record<string, string> = {}): Promise<void> {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`[scenes] unknown scene "${id}"`);
    if (!this.ctx) throw new Error('[scenes] setContext() must be called before go()');
    const navigation = ++this.navigation;
    this.leaveCurrent();
    this.loader.visible = true;

    let scene: Scene | undefined;
    try {
      scene = await factory(this.ctx);
      await scene.init(params);
    } catch (err) {
      scene?.destroy({ children: true });
      if (navigation === this.navigation) this.loader.visible = false;
      throw err;
    }
    if (navigation !== this.navigation) {
      scene.destroy({ children: true }); // a newer go() won the race
      return;
    }

    this.loader.visible = false;
    this.root.addChildAt(scene, 0);
    this.current = scene;
    this.id = id;
    this.publish();
    scene.enter();
  }

  get currentId(): string | null {
    return this.id;
  }

  private leaveCurrent(): void {
    const old = this.current;
    this.current = null;
    this.id = null;
    this.publish();
    if (!old) return;
    old.exit();
    this.root.removeChild(old);
    old.destroy({ children: true });
  }

  private publish(): void {
    if (import.meta.env.DEV) window.__bk = { ...window.__bk, sceneId: this.id };
  }
}

function createLoader(): Graphics {
  const loader = new Graphics()
    .arc(0, 0, 48, 0, Math.PI * 1.5)
    .stroke({ color: 0xf3ead8, width: 10, alpha: 0.8, cap: 'round' });
  loader.position.set(DESIGN.w / 2, DESIGN.h / 2);
  loader.visible = false;
  return loader;
}
