import {
  Container,
  Graphics,
  Point,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type DestroyOptions,
  type FederatedPointerEvent,
} from 'pixi.js';
import { sprite } from '../../core/Assets';
import { LampLightFilter } from '../../core/fx/LampLightFilter';
import { DESIGN } from '../../core/Layout';
import { mulberry32 } from '../../core/Rng';
import { Scene } from '../../core/Scene';
import { Button } from '../../ui/Button';
import { FactCard } from '../../ui/FactCard';
import { Stars } from '../../ui/Stars';
import { Theme } from '../../ui/Theme';
import { TopBar } from '../../ui/TopBar';
import { dist, geigerLevel, hit, isLit, levelConfig, minedCount, starsFor, type Level, type OreType, type Vein } from './rules';
import { Bat, Drip, GeigerView, OilBar, Particles, VeinView, artOfHeight, easeOutCubic, follow, radialTexture } from './views';

const W = DESIGN.w;
const H = DESIGN.h;

const LIGHT = { ambient: 0.06, flicker: 0.15, introRadius: 0.24, summaryRadius: 0.5, summaryAmbient: 0.16 };
/** A vein counts as lit (tappable, glowing) out to this share of the light's fade-out radius. */
const LIT_FRACTION = 0.7;
const LAMP = {
  height: 160,
  /** Lamp art anchor: the middle of the glass, where the light comes from. */
  glass: 0.6,
  follow: 12,
  knockFollow: 26,
  knockS: 0.35,
  knockPx: 220,
  minX: 60,
  maxX: W - 60,
  minY: TopBar.HEIGHT + 80,
  maxY: H - 40,
};
/** A press that wanders further than this (px) is a drag, not a tap. */
const TAP_SLOP = 30;
const SHAKE = { px: 4, s: 0.1 };
const DRIP_DIM = { s: 1.2, ambient: 0.02, radius: 0.3, recover: 0.3 };
const DRIP_TOP = TopBar.HEIGHT + 62;
const DARK_S = 1;
const BANNER_S = 3.6;
const GEIGER = { size: 120, margin: 24, volume: 0.4, hold: 0.15 };
const LOW_OIL = 0.2;
const RAIL_Y = 1010;
const MUSIC_VOLUME = 0.35;
const DRIP_VOLUME = 0.3;

type Phase = 'intro' | 'play' | 'ending' | 'result' | 'summary' | 'fading';
type Pt = { x: number; y: number };

interface LevelText {
  name: string;
  year: string;
  h: string;
}

interface LevelResult {
  mined: number;
  total: number;
  stars: 1 | 2 | 3;
}

interface Tween {
  t: number;
  dur: number;
  step: (p: number) => void;
  done?: () => void;
}

/** Dev-only hook for the smoke test; positions are on-screen CSS px, like `__bk.buttons`. */
interface MineDev {
  readonly veins: { x: number; y: number; type: OreType; hitsLeft: number }[];
  readonly lamp: { x: number; y: number };
  readonly drips: { x: number }[];
  readonly bats: { x: number; y: number; flying: boolean }[];
  readonly phase: Phase;
  readonly level: number;
  /** A drip has just doused the lamp. */
  readonly dimmed: boolean;
  /** Seconds of oil left; writable so a test can run the lamp dry. */
  oil: number;
}
type DevBk = NonNullable<Window['__bk']> & { mine?: MineDev };

/**
 * Sztolnia (Kowary): drag the miner's lamp through three dark galleries, find the ore veins in its
 * light and tap each one three times before the oil runs out. Drips douse the lamp, bats knock it
 * away and a Geiger counter crackles near uranium.
 */
export default class MineScene extends Scene {
  private readonly camera = new Container();
  private readonly world = new Container();
  private readonly veinLayer = new Container();
  private readonly hazards = new Container();
  private readonly fx = new Container();
  private readonly pipLayer = new Container();
  private readonly lampView = new Container();
  private readonly hud = new Container();
  private readonly overlay = new Container();
  private readonly blackout = new Graphics().rect(0, 0, W, H).fill(0x000000);
  private readonly light = new LampLightFilter();
  private readonly rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  private particles!: Particles;
  private bar!: TopBar;
  private oilBar!: OilBar;
  private geiger!: GeigerView;
  private halo!: Sprite;
  private flame!: Graphics;
  private lampArm!: Container;
  private haloTex: Texture = Texture.WHITE;
  private bg: Sprite | null = null;
  private banner: Container | null = null;

  private field = false;
  private phase: Phase = 'intro';
  private levelTexts: LevelText[] = [];
  private facts: string[] = [];
  private level: Level | null = null;
  private veins: Vein[] = [];
  private readonly veinViews = new Map<number, VeinView>();
  private minedOrder: OreType[] = [];
  private drips: Drip[] = [];
  private bats: Bat[] = [];
  private results: LevelResult[] = [];
  private tweens: Tween[] = [];

  private lamp: Pt = { x: W / 2, y: 620 };
  private target: Pt = { x: W / 2, y: 620 };
  private swing = 0;
  private knockT = 0;
  private dragging: number | null = null;
  private readonly downs = new Map<number, Pt & { moved: boolean }>();

  private time = 0;
  private oil = 0;
  private lightRadius = LIGHT.introRadius;
  private ambient = LIGHT.ambient;
  private dimT = 0;
  private darkT = -1;
  private shakeT = 0;
  private shakeAmp = 0;
  private geigerNow = 0;
  private geigerWant = 0;
  private geigerHeld = 0;

  async init(params: Record<string, string>): Promise<void> {
    this.field = params.field === '1';
    await this.ctx.assets.loadGroup('mine');
    const { i18n } = this.ctx;
    this.levelTexts = i18n.get<LevelText[]>('mine.levels') ?? [];
    this.facts = i18n.get<string[]>('mine.facts') ?? [];
    this.build();
    this.showIntro();
  }

  enter(): void {
    const { audio } = this.ctx;
    audio.play('mine.music', { loop: true, volume: MUSIC_VOLUME });
    audio.play('mine.drip', { loop: true, volume: DRIP_VOLUME });
    this.publishDev();
  }

  exit(): void {
    const { audio } = this.ctx;
    for (const m of ['mine.music', 'mine.drip', 'mine.geigerSlow', 'mine.geigerFast']) audio.stop(m);
    this.tweens = [];
    if (import.meta.env.DEV) delete (window.__bk as DevBk | undefined)?.mine;
  }

  override destroy(options?: DestroyOptions): void {
    super.destroy(options);
    this.light.destroy();
    if (this.haloTex !== Texture.WHITE) this.haloTex.destroy(true);
  }

  update(dt: number): void {
    this.time += dt;
    this.runTweens(dt);
    this.moveLamp(dt);
    this.updateLight(dt);
    this.updateVeins(dt);
    if (this.phase === 'play') {
      this.updateHazards(dt, true);
      this.updateOil(dt);
    } else if (this.phase === 'ending') {
      this.updateHazards(dt, false); // drops and bats move on, but can no longer hurt
    }
    this.updateGeiger(dt);
    this.particles.update(dt);
    this.updateShake(dt);
  }

  // ---------------------------------------------------------------- building

  private build(): void {
    const { i18n, audio, kiosk, assets } = this.ctx;
    this.eventMode = 'static';
    this.hitArea = new Rectangle(0, 0, W, H);
    this.on('pointerdown', this.onDown, this);
    this.on('pointermove', this.onMove, this);
    this.on('pointerup', this.onUp, this);
    this.on('pointerupoutside', this.onUp, this);
    this.on('pointercancel', this.onUp, this);
    this.on('pointertap', this.onTap, this);

    this.light.ambient = LIGHT.ambient;
    this.light.flicker = LIGHT.flicker;
    this.light.resolution = 'inherit';
    this.world.filters = [this.light];
    // uv of the filtered area = design px / (1920, 1080), so the light sits right on the lamp
    this.world.filterArea = new Rectangle(0, 0, W, H);
    this.world.addChild(this.veinLayer);
    this.particles = new Particles(this.rng);
    // the lamp hangs in the gallery: pick sparks and the pickaxe fly in front of it
    this.camera.addChild(this.world, this.pipLayer, this.hazards, this.lampView, this.fx, this.particles);
    // Pixi hit-tests passive children of a static scene too: anything drawn over a vein (the swinging
    // pick, sparks, a bat) would swallow the tap. Decoration never takes pointer events.
    for (const layer of [this.pipLayer, this.hazards, this.fx, this.particles]) layer.eventMode = 'none';

    this.buildLamp();

    this.bar = new TopBar({
      title: i18n.t('mine.title'),
      backLabel: i18n.t('ui.back'),
      onBack: () => this.ctx.go('hub'),
      audio,
      muteLabel: i18n.t('ui.mute'),
      kiosk,
      layout: this.ctx.layout,
    });
    this.oilBar = new OilBar(i18n.t('mine.hud.oil'));
    this.oilBar.position.set((W - OilBar.W) / 2 + 30, TopBar.HEIGHT + 22);
    this.oilBar.visible = false;
    this.geiger = new GeigerView(assets, this.rng, GEIGER.size);
    this.geiger.position.set(W - GEIGER.margin - GEIGER.size, H - GEIGER.margin - GEIGER.size);
    this.geiger.visible = false;
    this.oilBar.eventMode = 'none';
    this.geiger.eventMode = 'none';
    this.hud.addChild(this.bar, this.oilBar, this.geiger);

    this.blackout.alpha = 0;
    this.blackout.eventMode = 'none';
    this.addChild(this.camera, this.hud, this.overlay, this.blackout);
  }

  /** Halo, flame and lamp art; the lamp hangs from its handle and swings as it moves. */
  private buildLamp(): void {
    this.haloTex = radialTexture();
    this.halo = new Sprite(this.haloTex);
    this.halo.anchor.set(0.5);
    this.halo.tint = 0xffb45a;
    this.halo.blendMode = 'add';

    const art = artOfHeight(this.ctx.assets, 'mine/lamp', LAMP.height, 0xb08040);
    art.anchor.set(0.5, 0);
    this.lampArm = new Container();
    this.lampArm.position.set(0, -LAMP.height * LAMP.glass);
    art.position.set(0, 0);
    this.flame = new Graphics()
      .ellipse(0, 0, 11, 18)
      .fill({ color: 0xffb347, alpha: 0.85 })
      .ellipse(0, 3, 6, 10)
      .fill({ color: 0xfff1c8 });
    this.flame.blendMode = 'add';
    this.flame.position.set(0, LAMP.height * LAMP.glass + 4);
    this.lampArm.addChild(art, this.flame);
    this.lampView.addChild(this.halo, this.lampArm);
    this.lampView.eventMode = 'none';
  }

  private setBackground(alias: Level['bg']): void {
    this.bg?.destroy();
    this.bg = sprite(this.ctx.assets, alias, { w: W, h: H, tint: 0x4a4038 });
    this.bg.width = W;
    this.bg.height = H;
    this.world.addChildAt(this.bg, 0);
  }

  // ---------------------------------------------------------------- flow

  private showIntro(): void {
    const { i18n } = this.ctx;
    this.phase = 'intro';
    this.setBackground('mine/bg_1');
    this.lightRadius = LIGHT.introRadius;
    const start = this.button(i18n.t('mine.intro.start'), 'mine.start', () => {
      if (this.phase !== 'intro') return;
      this.fadeThen(() => this.startLevel(1));
    });
    this.overlay.addChild(
      this.card([heading(i18n.t('mine.intro.h'), 64), para(i18n.t('mine.intro.p'), 32, Theme.color.paper, 960), start], 1100, W / 2, 640),
    );
  }

  private startLevel(index: 1 | 2 | 3): void {
    const { assets } = this.ctx;
    this.clearLevel();
    const level = levelConfig(index, this.rng);
    this.level = level;
    this.veins = level.veins.map((v) => ({ ...v }));
    this.minedOrder = [];
    this.setBackground(level.bg);

    for (const v of this.veins) {
      const view = new VeinView(assets, v, this.rng, this.pipLayer);
      view.on('pointertap', (e) => this.tapVein(view, e));
      this.veinLayer.addChild(view);
      this.veinViews.set(v.id, view);
    }
    this.drips = level.drips.map((d, i) => new Drip(d.x, d.periodS, 2.5 + i * 1.7 + this.rng() * d.periodS, DRIP_TOP, H - 16));
    this.bats = Array.from({ length: level.bats }, (_, i) => new Bat(assets, this.rng, 8 + i * 7 + this.rng() * 4));
    this.hazards.addChild(...this.drips, ...this.bats);
    this.hazards.visible = true;

    this.oil = level.oilSeconds;
    this.lightRadius = level.lampRadius;
    this.ambient = LIGHT.ambient;
    this.dimT = 0;
    this.darkT = -1;
    this.knockT = 0;
    this.dragging = null;
    this.lamp = { x: W / 2, y: 620 };
    this.target = { ...this.lamp };
    this.lampView.visible = true;
    this.oilBar.visible = true;
    this.oilBar.set(1, 0);
    this.geiger.visible = this.veins.some((v) => v.type === 'uranium');
    this.setGeiger(0);
    this.updateCounter();
    this.showBanner(index);
    this.phase = 'play';
  }

  private endLevel(reason: 'done' | 'dark'): void {
    const level = this.level;
    if (this.phase !== 'play' || !level) return;
    this.phase = 'ending';
    this.dragging = null;
    this.setGeiger(0);
    const mined = minedCount(this.veins);
    this.results[level.index - 1] = { mined, total: this.veins.length, stars: starsFor(mined, this.veins.length) };
    if (reason === 'dark') {
      this.ctx.audio.play('mine.rumble');
      this.darkT = 0;
      this.shake(7, 0.7);
      this.particles.dust(50);
      this.wait(DARK_S, () => this.rollCart(reason));
    } else {
      this.wait(0.7, () => this.rollCart(reason));
    }
  }

  /** The bell rings and the cart rolls in from the left with the ore mined on this level. */
  private rollCart(reason: 'done' | 'dark'): void {
    const { assets, audio } = this.ctx;
    audio.play('mine.bell');
    this.phase = 'result';
    this.oilBar.visible = false;
    this.geiger.visible = false;
    this.hazards.visible = false;
    this.banner?.destroy({ children: true });
    this.banner = null;

    const dimmer = new Graphics().rect(0, TopBar.HEIGHT, W, H - TopBar.HEIGHT).fill({ color: 0x05070b, alpha: 0.55 });
    const rails = new Graphics();
    for (let x = 10; x < 900; x += 64) rails.rect(x, RAIL_Y + 6, 36, 12).fill(0x3e2c1e);
    rails.rect(0, RAIL_Y, 900, 8).fill(0x8a9098).rect(0, RAIL_Y + 6, 900, 2).fill(0x4b5056);

    const cart = new Container();
    const art = artOfHeight(assets, 'mine/cart', 240, 0x6a4a2a);
    art.anchor.set(0.5, 1);
    cart.addChild(art, this.cartLoad(art.width));
    cart.position.set(-300, RAIL_Y + 4);
    for (const deco of [dimmer, rails, cart]) deco.eventMode = 'none';
    this.overlay.addChild(dimmer, rails, cart);
    dimmer.alpha = 0;
    this.tween(1.6, (p) => {
      dimmer.alpha = Math.min(1, p * 3);
      cart.x = -300 + (380 + 300) * easeOutCubic(p);
      cart.y = RAIL_Y + 4 - Math.abs(Math.sin(p * 30)) * 3 * (1 - p);
    });
    this.wait(0.9, () => this.showResult(reason));
  }

  /** Nuggets of the mined ore piled on the cart, the first-mined at the bottom. */
  private cartLoad(cartW: number): Container {
    const load = new Container();
    const perRow = [4, 3, 2];
    let row = 0;
    let inRow = 0;
    for (const type of this.minedOrder) {
      if (inRow >= perRow[Math.min(row, perRow.length - 1)]) {
        row++;
        inRow = 0;
      }
      const n = perRow[Math.min(row, perRow.length - 1)];
      const x = (inRow - (n - 1) / 2) * cartW * 0.22;
      const y = -198 - row * 38;
      if (type === 'uranium') {
        // uranium keeps its faint green glow even in the cart
        const glow = new Sprite(this.haloTex);
        glow.anchor.set(0.5);
        glow.tint = 0x8dff5a;
        glow.blendMode = 'add';
        glow.alpha = 0.55;
        glow.scale.set(110 / 256);
        glow.position.set(x, y);
        load.addChild(glow);
      }
      const nug = artOfHeight(this.ctx.assets, type === 'iron' ? 'mine/vein_iron' : 'mine/vein_uranium', 72, 0x7a5a3a);
      nug.anchor.set(0.5);
      nug.position.set(x, y);
      nug.rotation = (this.rng() - 0.5) * 0.5;
      load.addChild(nug);
      inRow++;
    }
    return load;
  }

  private showResult(reason: 'done' | 'dark'): void {
    const level = this.level;
    if (!level) return;
    const { i18n, audio } = this.ctx;
    const r = this.results[level.index - 1];
    const stars = new Stars(3, 84);
    stars.onStar = () => audio.play('ui.star');
    const next = this.button(i18n.t('ui.next'), 'mine.next', () => this.next());
    const card = this.card(
      [
        heading(i18n.t(reason === 'done' ? 'mine.level.done' : 'mine.level.dark'), 58),
        para(this.levelTexts[level.index - 1]?.name ?? '', 28, Theme.color.emberSoft),
        para(i18n.t('mine.hud.mined', { m: r.mined, n: r.total }), 34, Theme.color.paper),
        stars,
        new FactCard(i18n.t('ui.didYouKnow'), this.facts[level.index - 1] ?? '', 900),
        next,
      ],
      1000,
      1250,
      H / 2 + 55,
      22,
    );
    this.overlay.addChild(card);
    this.popIn(card, () => stars.set(r.stars));
  }

  private next(): void {
    const level = this.level;
    if (this.phase !== 'result' || !level) return;
    this.phase = 'fading';
    this.fadeThen(() => (level.index < 3 ? this.startLevel((level.index + 1) as 2 | 3) : this.showSummary()));
  }

  private showSummary(): void {
    const { i18n, audio, save } = this.ctx;
    this.clearLevel();
    this.phase = 'summary';
    this.level = null;
    this.veins = [];
    this.updateCounter();
    this.setBackground('mine/bg_3');
    this.lightRadius = LIGHT.summaryRadius;
    this.ambient = LIGHT.summaryAmbient;
    this.darkT = -1;
    this.lamp = { x: W / 2, y: H / 2 };
    this.target = { ...this.lamp };
    this.lampView.visible = false;

    const mined = this.results.reduce((s, r) => s + r.mined, 0);
    const total = this.results.reduce((s, r) => s + r.total, 0);
    const starSum = this.results.reduce((s, r) => s + r.stars, 0);
    const grade = starsFor(mined, total);
    save.record('mine', grade, this.field);

    const stars = new Stars(9, 60);
    stars.onStar = () => audio.play('ui.star');
    const again = this.button(i18n.t('ui.again'), 'mine.again', () => {
      if (this.phase !== 'summary') return;
      this.phase = 'fading';
      this.results = [];
      this.fadeThen(() => this.startLevel(1));
    });
    const back = this.button(i18n.t('ui.back'), 'mine.back', () => this.ctx.go('hub'), 'quiet');
    const row = new Container();
    back.x = again.box.w + 32;
    row.addChild(again, back);

    const card = this.card(
      [
        heading(i18n.t('mine.sum.h'), 68),
        heading(i18n.t(`mine.titles.${grade}`), 44, Theme.color.star),
        stars,
        para(i18n.t('mine.hud.mined', { m: mined, n: total }), 32, Theme.color.paper),
        new FactCard(i18n.t('ui.didYouKnow'), this.facts[3] ?? '', 960),
        row,
      ],
      1100,
      W / 2,
      H / 2 + 55,
      24,
    );
    this.overlay.addChild(card);
    this.popIn(card, () => stars.set(starSum));
  }

  private clearLevel(): void {
    this.tweens = [];
    for (const view of this.veinViews.values()) view.destroy({ children: true });
    this.veinViews.clear();
    for (const c of this.hazards.removeChildren()) c.destroy({ children: true });
    for (const c of this.fx.removeChildren()) c.destroy({ children: true });
    for (const c of this.overlay.removeChildren()) c.destroy({ children: true });
    this.drips = [];
    this.bats = [];
    this.particles.clear();
    this.banner?.destroy({ children: true });
    this.banner = null;
    this.setGeiger(0);
    this.shakeT = 0;
  }

  // ---------------------------------------------------------------- input

  private onDown(e: FederatedPointerEvent): void {
    if (e.target !== this && !(e.target instanceof VeinView)) return;
    const p = this.toLocal(e.global);
    if (p.y < TopBar.HEIGHT) return; // the top bar's own background
    this.downs.set(e.pointerId, { x: p.x, y: p.y, moved: false });
    if (this.dragging === null && this.phase === 'play') this.dragging = e.pointerId;
  }

  private onMove(e: FederatedPointerEvent): void {
    if (e.pointerId !== this.dragging) return;
    const down = this.downs.get(e.pointerId);
    if (!down) return;
    const p = this.toLocal(e.global);
    if (!down.moved && Math.hypot(p.x - down.x, p.y - down.y) > TAP_SLOP) down.moved = true;
    if (down.moved && this.phase === 'play' && this.knockT <= 0) this.aimLamp(p);
  }

  private onUp(e: FederatedPointerEvent): void {
    // `downs` keeps the press until the next one: pointertap comes after pointerup and needs `moved`
    if (e.pointerId === this.dragging) this.dragging = null;
  }

  /** A tap in the dark sends the lamp there. */
  private onTap(e: FederatedPointerEvent): void {
    if (e.target !== this || this.phase !== 'play' || this.wasDrag(e)) return;
    const p = this.toLocal(e.global);
    if (p.y >= TopBar.HEIGHT) this.aimLamp(p);
  }

  private wasDrag(e: FederatedPointerEvent): boolean {
    return this.downs.get(e.pointerId)?.moved ?? false;
  }

  private tapVein(view: VeinView, e: FederatedPointerEvent): void {
    if (this.phase !== 'play' || this.wasDrag(e)) return;
    const i = this.veins.findIndex((v) => v.id === view.veinId);
    const vein = this.veins[i];
    if (!vein || vein.hitsLeft === 0) return;
    const at = this.toLocal(e.global);
    if (!isLit(this.lamp, vein, this.litRadius())) {
      this.aimLamp(at); // a vein in the dark is just more dark: bring the lamp
      return;
    }
    const after = hit(vein);
    this.veins[i] = after;
    this.ctx.audio.play('mine.pick', { volume: 0.9, rate: 0.9 + this.rng() * 0.2 });
    this.particles.sparks(at.x, at.y, 10);
    this.flash(at);
    this.swingPick(at);
    this.shake(SHAKE.px, SHAKE.s);
    view.onHit(after.hitsLeft);
    if (after.hitsLeft > 0) return;
    view.pop();
    this.minedOrder.push(vein.type);
    this.flyNugget(vein);
    this.updateCounter();
    if (minedCount(this.veins) === this.veins.length) this.endLevel('done');
  }

  private aimLamp(p: Pt): void {
    this.target = {
      x: Math.max(LAMP.minX, Math.min(LAMP.maxX, p.x)),
      y: Math.max(LAMP.minY, Math.min(LAMP.maxY, p.y)),
    };
  }

  // ---------------------------------------------------------------- per frame

  private moveLamp(dt: number): void {
    if (this.phase === 'intro') {
      this.target = { x: W / 2 + 620 * Math.sin(this.time * 0.45), y: 560 + 230 * Math.sin(this.time * 0.9 + 1) };
    }
    this.knockT = Math.max(0, this.knockT - dt);
    const k = follow(this.knockT > 0 ? LAMP.knockFollow : LAMP.follow, dt);
    const prevX = this.lamp.x;
    this.lamp.x += (this.target.x - this.lamp.x) * k;
    this.lamp.y += (this.target.y - this.lamp.y) * k;
    const vx = dt > 0 ? (this.lamp.x - prevX) / dt : 0;
    // a hanging lamp trails behind the hand
    this.swing += (Math.max(-0.3, Math.min(0.3, -vx * 0.0006)) - this.swing) * follow(6, dt);
    this.lampArm.rotation = this.swing + 0.03 * Math.sin(this.time * 1.7);
    this.lampView.position.set(this.lamp.x, this.lamp.y);
  }

  private updateLight(dt: number): void {
    let radius = this.lightRadius;
    let ambient = this.ambient;
    let flicker = LIGHT.flicker;
    if (this.dimT > 0) {
      this.dimT = Math.max(0, this.dimT - dt);
      const k = Math.min(1, this.dimT / DRIP_DIM.recover);
      radius *= 1 - (1 - DRIP_DIM.radius) * k;
      ambient += (DRIP_DIM.ambient - ambient) * k;
    }
    if (this.phase === 'play' && this.level) {
      const f = this.oil / this.level.oilSeconds;
      if (f < LOW_OIL) flicker += 0.35 * (1 - f / LOW_OIL);
    }
    if (this.darkT >= 0) {
      this.darkT += dt;
      const k = Math.min(1, this.darkT / 0.25);
      radius *= 1 - k;
      ambient *= 1 - k;
    }
    this.light.radius = radius;
    this.light.ambient = ambient;
    this.light.flicker = flicker;
    this.light.time = this.time;
    this.light.light = [this.lamp.x / W, this.lamp.y / H];

    // the same flicker as the shader, so halo, flame and light breathe together
    const wave = 1 - flicker * 0.5 * (0.5 + 0.5 * Math.sin(this.time * 23) * Math.sin(this.time * 7.3));
    const on = this.lightRadius > 0 ? radius / this.lightRadius : 0;
    this.halo.alpha = 0.32 * on * wave;
    this.halo.scale.set((radius * H * 1.5) / 128);
    this.flame.alpha = Math.min(1, on * 1.2) * wave;
    this.flame.scale.set(0.6 + 0.4 * on, (0.6 + 0.4 * on) * (0.92 + 0.12 * wave));
  }

  /** Radius (px) within which a vein is lit enough to see and mine. */
  private litRadius(): number {
    return this.light.radius * H * LIT_FRACTION;
  }

  /** Lamp light at a point, 0..1, matching the shader's falloff. */
  private brightness(p: Pt): number {
    const r = this.light.radius * H;
    const d = dist(p, this.lamp);
    const t = Math.max(0, Math.min(1, (d - r * 0.15) / (r * 0.85)));
    return 1 - t * t * (3 - 2 * t);
  }

  private updateVeins(dt: number): void {
    const r = this.litRadius();
    for (const v of this.veins) {
      const view = this.veinViews.get(v.id);
      if (!view) continue;
      view.update(dt, v.hitsLeft > 0 && isLit(this.lamp, v, r));
      if (view.gone) {
        view.destroy({ children: true });
        this.veinViews.delete(v.id);
      }
    }
  }

  private updateHazards(dt: number, live: boolean): void {
    for (const drip of this.drips) {
      const r = drip.update(dt, this.lamp);
      if (r === 'hit' && live) {
        this.dimT = DRIP_DIM.s;
        this.particles.steam(this.lamp.x, this.lamp.y - 10);
      } else if (r === 'splash') {
        this.particles.splash(drip.x, H - 18);
      }
    }
    for (const bat of this.bats) {
      if (bat.update(dt, this.lamp, (p) => this.brightness(p)) && live) this.knockLamp();
    }
  }

  /** A bat bumps the lamp: it jumps 220 px in a random direction and drops out of the hand. */
  private knockLamp(): void {
    this.ctx.audio.play('mine.bat');
    let to = this.lamp;
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2;
      to = { x: this.lamp.x + Math.cos(a) * LAMP.knockPx, y: this.lamp.y + Math.sin(a) * LAMP.knockPx };
      if (to.x >= LAMP.minX && to.x <= LAMP.maxX && to.y >= LAMP.minY && to.y <= LAMP.maxY) break;
    }
    this.aimLamp(to);
    this.knockT = LAMP.knockS;
    this.dragging = null;
    this.swing = this.rng() < 0.5 ? -0.5 : 0.5;
    this.shake(3, 0.15);
  }

  private updateOil(dt: number): void {
    const level = this.level;
    if (!level) return;
    this.oil = Math.max(0, this.oil - dt);
    this.oilBar.set(this.oil / level.oilSeconds, dt);
    if (this.oil <= 0) this.endLevel('dark');
  }

  private updateGeiger(dt: number): void {
    const want = this.phase === 'play' ? geigerLevel(this.lamp, this.veins) : 0;
    if (want !== this.geigerWant) {
      this.geigerWant = want;
      this.geigerHeld = 0;
    }
    this.geigerHeld += dt;
    // a short hold keeps the loops from stuttering while the lamp hovers on a threshold
    if (want !== this.geigerNow && this.geigerHeld >= GEIGER.hold) this.setGeiger(want);
    this.geiger.update(dt);
  }

  private setGeiger(level: number): void {
    const { audio } = this.ctx;
    this.geigerNow = level;
    this.geigerWant = level;
    this.geiger.setLevel(level);
    audio.stop('mine.geigerSlow');
    audio.stop('mine.geigerFast');
    if (level === 1 || level === 2) {
      audio.play('mine.geigerSlow', { loop: true, volume: GEIGER.volume, rate: level === 1 ? 1 : 1.4 });
    } else if (level === 3) {
      audio.play('mine.geigerFast', { loop: true, volume: GEIGER.volume });
    }
  }

  private shake(px: number, s: number): void {
    this.shakeAmp = Math.max(this.shakeT > 0 ? this.shakeAmp : 0, px);
    this.shakeT = Math.max(this.shakeT, s);
  }

  private updateShake(dt: number): void {
    if (this.shakeT <= 0) {
      this.camera.position.set(0, 0);
      return;
    }
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.camera.position.set((this.rng() * 2 - 1) * this.shakeAmp, (this.rng() * 2 - 1) * this.shakeAmp);
  }

  // ---------------------------------------------------------------- effects

  private updateCounter(): void {
    const { i18n } = this.ctx;
    const level = this.level;
    if (!level) {
      this.bar.setSubtitle('');
      return;
    }
    const name = this.levelTexts[level.index - 1]?.name ?? '';
    const count = i18n.t('mine.hud.mined', { m: minedCount(this.veins), n: this.veins.length });
    this.bar.setSubtitle(`${name}  ·  ${count}`);
  }

  /** A brief hot glint where the pick bites. */
  private flash(at: Pt): void {
    const glint = new Sprite(this.haloTex);
    glint.anchor.set(0.5);
    glint.tint = 0xffd890;
    glint.blendMode = 'add';
    glint.position.set(at.x, at.y);
    this.fx.addChild(glint);
    this.tween(
      0.16,
      (p) => {
        glint.scale.set((60 + 70 * p) / 128);
        glint.alpha = 0.95 * (1 - p);
      },
      () => glint.destroy(),
    );
  }

  /** The pickaxe swings down onto the tapped spot. */
  private swingPick(at: Pt): void {
    const pick = artOfHeight(this.ctx.assets, 'mine/pickaxe', 130, 0x9a9a9a);
    pick.anchor.set(0.62, 0.96);
    pick.position.set(at.x + 68, at.y + 96);
    this.fx.addChild(pick);
    this.tween(
      0.34,
      (p) => {
        pick.rotation = 0.7 - 1.0 * easeOutCubic(Math.min(p / 0.35, 1));
        pick.alpha = p < 0.6 ? 1 : (1 - p) / 0.4;
      },
      () => pick.destroy(),
    );
  }

  /** A nugget of the mined ore flies up to the counter in the top bar. */
  private flyNugget(vein: Vein): void {
    const nug = artOfHeight(this.ctx.assets, vein.type === 'iron' ? 'mine/vein_iron' : 'mine/vein_uranium', 70, 0x7a5a3a);
    nug.anchor.set(0.5);
    nug.eventMode = 'none';
    const from = { x: vein.x, y: vein.y };
    const to = { x: W / 2, y: 84 };
    this.overlay.addChild(nug);
    this.tween(
      0.6,
      (p) => {
        const e = easeOutCubic(p);
        nug.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e - Math.sin(p * Math.PI) * 160);
        nug.alpha = p < 0.8 ? 1 : (1 - p) / 0.2;
        nug.rotation = p * 4;
      },
      () => nug.destroy(),
    );
  }

  private showBanner(index: 1 | 2 | 3): void {
    const t = this.levelTexts[index - 1];
    if (!t) return;
    const banner = new Container();
    const content = new Container();
    const h = stack(content, [heading(t.name, 58), para(t.year, 28, Theme.color.emberSoft), para(t.h, 32, Theme.color.paper, 1080)], 10);
    const bg = new Graphics().roundRect(-640, -30, 1280, h + 60, 30).fill({ color: Theme.color.night, alpha: 0.8 });
    banner.addChild(bg, content);
    banner.position.set(W / 2, 250);
    banner.alpha = 0;
    banner.eventMode = 'none';
    this.hud.addChild(banner);
    this.banner = banner;
    this.tween(
      BANNER_S,
      (p) => {
        banner.alpha = p < 0.08 ? p / 0.08 : p > 0.85 ? (1 - p) / 0.15 : 1;
      },
      () => {
        if (this.banner === banner) this.banner = null;
        banner.destroy({ children: true });
      },
    );
  }

  // ---------------------------------------------------------------- ui helpers

  private button(label: string, name: string, onPress: () => void, variant: 'primary' | 'quiet' = 'primary'): Button {
    const { kiosk, layout, audio } = this.ctx;
    return new Button(label, { name, variant, kiosk, layout, onTap: () => audio.play('ui.tap'), onPress });
  }

  /** A dark card around `views` stacked and centred, centred on (x, y). */
  private card(views: Container[], width: number, x: number, y: number, gap = 26): Container {
    const card = new Container();
    const content = new Container();
    const h = stack(content, views, gap);
    const pad = 44;
    const bg = new Graphics()
      .roundRect(-width / 2, -pad + 8, width, h + pad * 2, 32)
      .fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(-width / 2, -pad, width, h + pad * 2, 32)
      .fill({ color: Theme.color.night, alpha: 0.92 })
      .stroke({ color: Theme.color.ember, alpha: 0.5, width: 2 });
    card.addChild(bg, content);
    card.position.set(x, y - h / 2);
    return card;
  }

  private popIn(view: Container, done?: () => void): void {
    const y = view.y;
    view.alpha = 0;
    this.tween(
      0.35,
      (p) => {
        view.alpha = p;
        view.y = y + 40 * (1 - easeOutCubic(p));
      },
      done,
    );
  }

  /** Fade to black, run `fn`, fade back in. */
  private fadeThen(fn: () => void): void {
    const prev = this.phase;
    this.phase = 'fading';
    this.blackout.eventMode = 'static';
    this.tween(
      0.35,
      (p) => (this.blackout.alpha = p),
      () => {
        if (this.phase === 'fading') this.phase = prev;
        // the new screen is ready: let it take input while the black fades away
        this.blackout.eventMode = 'none';
        fn();
        this.tween(0.45, (p) => (this.blackout.alpha = 1 - p));
      },
    );
  }

  private tween(dur: number, step: (p: number) => void, done?: () => void): void {
    this.tweens.push({ t: 0, dur, step, done });
  }

  private wait(dur: number, done: () => void): void {
    this.tween(dur, () => {}, done);
  }

  private runTweens(dt: number): void {
    const list = this.tweens;
    for (const tw of [...list]) {
      if (this.tweens !== list) return; // a callback cleared the level: the old tweens are gone
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      tw.step(p);
      if (p < 1) continue;
      const i = list.indexOf(tw);
      if (i >= 0) list.splice(i, 1);
      tw.done?.();
    }
  }

  // ---------------------------------------------------------------- dev

  private publishDev(): void {
    if (!import.meta.env.DEV) return;
    const bk = (window.__bk ??= { sceneId: null }) as DevBk;
    const screen = (x: number, y: number) => {
      const p = this.toGlobal(new Point(x, y));
      return { x: p.x, y: p.y };
    };
    const scene = this;
    bk.mine = {
      get veins() {
        return scene.veins.map((v) => ({ ...screen(v.x, v.y), type: v.type, hitsLeft: v.hitsLeft }));
      },
      get lamp() {
        return screen(scene.lamp.x, scene.lamp.y);
      },
      get drips() {
        return scene.drips.map((d) => ({ x: screen(d.x, 0).x }));
      },
      get bats() {
        return scene.bats.map((b) => ({ ...screen(b.x, b.y), flying: b.visible }));
      },
      get phase() {
        return scene.phase;
      },
      get level() {
        return scene.level?.index ?? 0;
      },
      get dimmed() {
        return scene.dimT > 0;
      },
      get oil() {
        return scene.oil;
      },
      set oil(s: number) {
        scene.oil = s;
      },
    };
  }
}

/** Stacks `views` top to bottom with `gap` between them, each centred on x = 0; returns the height. */
function stack(parent: Container, views: Container[], gap: number): number {
  let y = 0;
  for (const v of views) {
    parent.addChild(v);
    const b = v.getLocalBounds();
    v.position.set(-(b.x + b.width / 2), y - b.y);
    y += b.height + gap;
  }
  return Math.max(0, y - gap);
}

function heading(text: string, size: number, fill: number = Theme.color.paper): Text {
  const t = new Text({
    text,
    style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: size, fill, align: 'center' },
  });
  t.anchor.set(0.5, 0);
  return t;
}

function para(text: string, size: number, fill: number = Theme.color.paper, wrap = 900): Text {
  const style = Theme.text.body(size, fill);
  style.wordWrapWidth = wrap;
  style.align = 'center';
  const t = new Text({ text, style });
  t.anchor.set(0.5, 0);
  return t;
}
