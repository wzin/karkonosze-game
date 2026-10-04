import { Container, FillGradient, Graphics, Rectangle, Sprite } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { sprite } from '../../core/Assets';
import { HeatHazeFilter } from '../../core/fx/HeatHazeFilter';
import { DESIGN } from '../../core/Layout';
import { mulberry32 } from '../../core/Rng';
import { Scene } from '../../core/Scene';
import { RoundProgress } from '../../ui/RoundProgress';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { TopBar } from '../../ui/TopBar';
import { ParticleLayer, Tweens, ease, mixColor, softDotTexture } from './fx';
import { pickOrders, saveStars, type Customer, type Made, type MineralId } from './rules';
import { Intro, Summary } from './screens';
import { BlowStep } from './steps/Blow';
import { ColorStep } from './steps/Color';
import { HeatStep } from './steps/Heat';
import { ResultStep } from './steps/Result';
import { ShapeStep } from './steps/Shape';
import type { Step, StepEnv } from './steps/Step';
import { InstructionCard, LAYOUT, Toast, type Vessel } from './ui';
import { Workpiece } from './Workpiece';

const ORDERS = 3;
const MUSIC_VOLUME = 0.45;
const FURNACE_VOLUME = 0.35;
const EMBER_EVERY = 0.07;
const EMBERS_MAX = 40;

interface Finished {
  stars: 1 | 2 | 3;
  vessel: Vessel;
  mineral: MineralId;
}

/**
 * Hutnik z Józefiny. The glassworks interior with a shimmering furnace; three customers, each order
 * four moves (heat → blow → colour → shape) and a verdict; a summary with the shift's title.
 * Layers, bottom up: hazed background with the fire glow, embers, shade, table (vessels), the
 * workpiece, the current step, particles, chrome (top bar, order, instruction, toast), screens.
 */
export default class GlassScene extends Scene {
  private readonly rng = mulberry32((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
  private readonly tw = new Tweens();
  private field = false;
  private time = 0;

  private haze!: HeatHazeFilter;
  private fire!: Container;
  private bloom!: AdvancedBloomFilter;
  private readonly embers = new ParticleLayer();
  private emberClock = 0;
  private readonly shade = new Graphics();
  private readonly table = new Container();
  private piece!: Workpiece;
  private readonly stepLayer = new Container();
  private readonly fx = new ParticleLayer();
  private readonly chrome = new Container();
  private readonly screens = new Container();
  private topBar!: TopBar;
  private progress!: RoundProgress;
  private readonly card = new InstructionCard(LAYOUT.card.w);
  private readonly toast = new Toast();
  private orderBubble: SpeechBubble | null = null;

  private step: Step | null = null;
  private screen: Intro | Summary | null = null;
  private orders: Customer[] = [];
  private index = 0;
  private made: Partial<Made> = {};
  private finished: Finished[] = [];

  override async init(params: Record<string, string>): Promise<void> {
    this.field = params.field === '1';
    await this.ctx.assets.loadGroup('glass');
    this.build();
  }

  override enter(): void {
    const { audio } = this.ctx;
    audio.play('glass.music', { loop: true, volume: MUSIC_VOLUME });
    audio.play('glass.furnace', { loop: true, volume: FURNACE_VOLUME });
    this.orders = pickOrders(this.rng, ORDERS);
    this.showIntro();
  }

  override exit(): void {
    const { audio } = this.ctx;
    audio.stop('glass.music');
    audio.stop('glass.furnace');
    audio.stop('glass.blow');
    this.step?.unmount();
    this.step = null;
    this.tw.clear();
  }

  override update(dt: number): void {
    this.time += dt;
    this.haze.time = this.time;
    // the fire breathes: a slow swell with a quick flicker on top
    this.fire.alpha = 0.62 + 0.18 * Math.sin(this.time * 1.7) + 0.08 * Math.sin(this.time * 7.3) * Math.sin(this.time * 3.1);
    this.bloom.bloomScale = 1.1 + 0.3 * Math.sin(this.time * 1.7);
    this.spawnEmbers(dt);
    this.embers.update(dt);
    this.tw.update(dt);
    this.piece.update(dt);
    this.step?.update(dt);
    this.fx.update(dt);
    this.card.update(dt);
    this.toast.update(dt);
    this.screen?.update(dt);
    for (const f of this.finished) if (!f.vessel.destroyed) f.vessel.update(dt);
    if (import.meta.env.DEV) this.publishDebug();
  }

  /** Dev only: live game state for the smoke test (`window.__bkGlass`), read-only. */
  private publishDebug(): void {
    if (!import.meta.env.DEV) return;
    const order = this.orders[this.index];
    (window as unknown as { __bkGlass?: unknown }).__bkGlass = {
      step: this.step?.kind ?? (this.screen instanceof Summary ? 'summary' : this.screen ? 'intro' : null),
      time: this.time,
      index: this.index,
      order: order ? { id: order.id, shape: order.shape, mineral: order.mineral, size: order.size } : null,
      ...(this.step?.debug() ?? {}),
    };
  }

  private build(): void {
    const { assets, i18n, audio, kiosk } = this.ctx;
    const t = i18n.t.bind(i18n);

    // background + fire glow under one heat-haze pass; the area is pinned to the design rect so the
    // furnace rect (uv of the filtered area) cannot drift when something pokes out of the scene
    const world = new Container();
    const bg = sprite(assets, 'glass/bg', { w: DESIGN.w, h: DESIGN.h, tint: 0x3a2a24 });
    bg.width = DESIGN.w;
    bg.height = DESIGN.h;
    this.fire = this.buildFire();
    world.addChild(bg, this.fire);
    this.haze = new HeatHazeFilter();
    const m = LAYOUT.furnaceMouth;
    this.haze.rect = [m.x / DESIGN.w, m.y / DESIGN.h, m.w / DESIGN.w, m.h / DESIGN.h];
    this.haze.intensity = 0.8;
    world.filters = [this.haze];
    world.filterArea = new Rectangle(0, 0, DESIGN.w, DESIGN.h);

    this.shade
      .rect(0, 0, 1320, DESIGN.h)
      .fill(
        new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
          colorStops: [
            { offset: 0, color: 'rgba(20,26,38,0.86)' },
            { offset: 0.7, color: 'rgba(20,26,38,0.6)' },
            { offset: 1, color: 'rgba(20,26,38,0)' },
          ],
          textureSpace: 'local',
        }),
      );
    this.shade.alpha = 0;

    this.piece = new Workpiece(assets);
    this.piece.position.set(LAYOUT.furnaceTip.x, LAYOUT.furnaceTip.y);

    this.topBar = new TopBar({
      title: t('glass.title'),
      backLabel: t('ui.back'),
      onBack: () => this.ctx.go('hub'),
      audio,
      muteLabel: t('ui.mute'),
      kiosk,
    });
    this.progress = new RoundProgress(ORDERS, 520);
    this.progress.position.set((DESIGN.w - 520) / 2, TopBar.HEIGHT + 12);
    this.card.position.set(LAYOUT.card.x, LAYOUT.card.y);
    this.card.visible = false;
    this.toast.position.set(960, 470);
    this.chrome.addChild(this.topBar, this.progress, this.card, this.toast);

    this.addChild(world, this.embers, this.shade, this.table, this.piece, this.stepLayer, this.fx, this.chrome, this.screens);
  }

  /** Orange glow in the dark furnace opening, bloomed; its alpha pulses in update(). */
  private buildFire(): Container {
    const f = LAYOUT.furnaceFire;
    const holder = new Container();
    const glow = new Graphics()
      .ellipse(f.x, f.y, f.rx, f.ry)
      .fill(
        new FillGradient({
          type: 'radial',
          center: { x: 0.5, y: 0.62 },
          innerRadius: 0,
          outerCenter: { x: 0.5, y: 0.5 },
          outerRadius: 0.5,
          colorStops: [
            { offset: 0, color: 'rgba(255,214,120,1)' },
            { offset: 0.45, color: 'rgba(255,140,40,0.85)' },
            { offset: 1, color: 'rgba(200,60,10,0)' },
          ],
          textureSpace: 'local',
        }),
      );
    glow.blendMode = 'add';
    holder.addChild(glow);
    this.bloom = new AdvancedBloomFilter({ threshold: 0.2, bloomScale: 1.2, brightness: 1.05, blur: 12, quality: 6 });
    holder.filters = [this.bloom];
    // pinned area: the opening plus room for the bloom to spread
    holder.filterArea = new Rectangle(f.x - f.rx - 160, f.y - f.ry - 160, (f.rx + 160) * 2, (f.ry + 160) * 2);
    return holder;
  }

  private spawnEmbers(dt: number): void {
    this.emberClock -= dt;
    if (this.emberClock > 0 || this.embers.count >= EMBERS_MAX) return;
    this.emberClock = EMBER_EVERY;
    const m = LAYOUT.furnaceMouth;
    const dot = new Sprite(softDotTexture());
    dot.anchor.set(0.5);
    dot.blendMode = 'add';
    dot.tint = mixColor(0xffc062, 0xff5a14, Math.random());
    dot.scale.set((8 + Math.random() * 14) / 128 * 2);
    dot.position.set(m.x + 40 + Math.random() * (m.w - 60), m.y + m.h * (0.45 + Math.random() * 0.5));
    this.embers.spawn(dot, {
      vx: 15 + Math.random() * 40,
      vy: -50 - Math.random() * 110,
      sway: 30,
      life: 1.4 + Math.random() * 1.4,
      endScale: 0.25,
    });
  }

  // ---------------------------------------------------------------- flow

  private showIntro(): void {
    this.setChrome(false);
    this.progress.set(0);
    // screens are torn down a frame later, outside the button's own event handler
    const intro = new Intro(this.ctx, this.t, this.orders, () =>
      this.tw.wait(0, () => {
        this.closeScreen();
        this.startGame(false);
      }),
    );
    this.openScreen(intro);
  }

  private startGame(newOrders: boolean): void {
    if (newOrders) this.orders = pickOrders(this.rng, ORDERS);
    this.index = 0;
    this.finished = [];
    this.table.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.setShade(false);
    this.startOrder();
  }

  private startOrder(): void {
    const order = this.orders[this.index];
    this.made = {};
    this.setChrome(true);
    this.topBar.setSubtitle(this.t('glass.orderNo', { i: this.index + 1, n: this.orders.length }));
    this.progress.set(this.index);
    this.showOrderBubble(order);

    const piece = this.piece;
    piece.reset();
    piece.visible = true;
    // a fresh gather slides into the furnace mouth
    piece.position.set(LAYOUT.furnaceTip.x - 300, LAYOUT.furnaceTip.y);
    this.tw.add(0.6, (p) => (piece.x = LAYOUT.furnaceTip.x - 300 * (1 - p)), { ease: ease.outCubic });
    this.haze.intensity = 1;

    this.run(
      new HeatStep(this.env(), (heat) => {
        this.made.heat = heat;
        this.haze.intensity = 0.7;
        this.run(new BlowStep(this.env(), (res) => {
          this.made.blow = res.score;
          this.run(new ColorStep(this.env(), (mineral) => {
            this.made.mineral = mineral;
            this.run(new ShapeStep(this.env(), mineral, (shape, vessel) => {
              this.made.shape = shape;
              this.showResult(vessel);
            }));
          }));
        }));
      }),
    );
  }

  private showResult(vessel: Vessel): void {
    const made = this.made as Made;
    const last = this.index === this.orders.length - 1;
    this.hideOrderBubble();
    this.setShade(true);
    this.piece.visible = false;
    // the next order (or the summary) is built a frame later, outside the button's event handler
    const result = new ResultStep(this.env(), made, vessel, last, () => this.tw.wait(0, () => this.nextOrder()));
    this.finished.push({ stars: result.stars, vessel, mineral: made.mineral });
    this.progress.set(this.index + 1);
    this.run(result);
  }

  private nextOrder(): void {
    this.index += 1;
    this.setShade(false);
    if (this.index < this.orders.length) {
      this.startOrder();
      return;
    }
    this.showSummary();
  }

  private showSummary(): void {
    this.endStep();
    this.setChrome(false);
    this.progress.set(ORDERS);
    this.topBar.setSubtitle('');
    this.setShade(true);
    const total = this.finished.reduce((sum, f) => sum + f.stars, 0);
    this.ctx.save.record('glass', saveStars(total), this.field);
    this.ctx.audio.play('glass.fanfare', { volume: 0.8 });
    this.confetti(total);
    const summary = new Summary(
      this.ctx,
      this.t,
      total,
      () =>
        this.tw.wait(0, () => {
          this.closeScreen();
          this.startGame(true);
        }),
      () => this.ctx.go('hub'),
    );
    this.openScreen(summary);
  }

  // ---------------------------------------------------------------- helpers

  private readonly t = (key: string, vars?: Record<string, string | number>): string => this.ctx.i18n.t(key, vars);

  private env(): StepEnv {
    return {
      ctx: this.ctx,
      t: this.t,
      order: this.orders[this.index],
      index: this.index,
      piece: this.piece,
      fx: this.fx,
      card: this.card,
      toast: this.toast,
      table: this.table,
      rng: this.rng,
    };
  }

  /** Swaps the current step for `next`; deferred one frame so a step never tears itself down mid-update. */
  private run(next: Step): void {
    this.tw.wait(0, () => {
      this.endStep();
      this.card.visible = true;
      this.step = next;
      next.mount(this.stepLayer);
    });
  }

  private endStep(): void {
    this.step?.unmount();
    this.step = null;
  }

  private openScreen(s: Intro | Summary): void {
    this.closeScreen();
    this.screen = s;
    this.screens.addChild(s);
  }

  private closeScreen(): void {
    if (!this.screen) return;
    const s = this.screen;
    this.screen = null;
    s.destroy({ children: true });
  }

  private setChrome(playing: boolean): void {
    // run() shows the card again when the next step mounts with its own text
    this.card.visible = false;
    this.toast.hide();
    if (!playing) this.hideOrderBubble();
  }

  private setShade(on: boolean): void {
    const from = this.shade.alpha;
    const to = on ? 1 : 0;
    this.tw.add(0.4, (p) => (this.shade.alpha = from + (to - from) * p), { ease: ease.linear });
  }

  private showOrderBubble(order: Customer): void {
    this.hideOrderBubble();
    const bubble = new SpeechBubble({
      portrait: this.ctx.assets.texture(`glass/portrait_${order.id}`),
      name: this.t(`glass.customers.${order.id}.name`),
      text: this.t(`glass.customers.${order.id}.line`),
      width: LAYOUT.order.w,
    });
    bubble.position.set(-LAYOUT.order.w, LAYOUT.order.y);
    this.chrome.addChildAt(bubble, 0);
    this.orderBubble = bubble;
    this.tw.add(
      0.5,
      (p) => {
        if (!bubble.destroyed) bubble.x = -LAYOUT.order.w + (LAYOUT.order.x + LAYOUT.order.w) * p;
      },
      { ease: ease.outBack },
    );
  }

  private hideOrderBubble(): void {
    this.orderBubble?.destroy({ children: true });
    this.orderBubble = null;
  }

  /** Falling stars over the table for a good shift. */
  private confetti(total: number): void {
    const n = total >= 8 ? 60 : total >= 5 ? 30 : 0;
    for (let i = 0; i < n; i++) {
      const g = new Graphics().star(0, 0, 5, 10 + Math.random() * 8, 5).fill(i % 4 === 0 ? 0xf6ead6 : 0xffcf66);
      g.position.set(1150 + Math.random() * 700, 120 + Math.random() * 100);
      this.fx.spawn(g, {
        vx: (Math.random() - 0.5) * 200,
        vy: 100 + Math.random() * 200,
        gravity: 220,
        spin: (Math.random() - 0.5) * 8,
        life: 2.2 + Math.random(),
        delay: Math.random() * 1.2,
      });
    }
  }
}
