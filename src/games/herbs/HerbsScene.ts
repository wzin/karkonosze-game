import { Container, Graphics, Point, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import { sprite } from '../../core/Assets';
import { DESIGN } from '../../core/Layout';
import { mulberry32, shuffle } from '../../core/Rng';
import { Scene } from '../../core/Scene';
import { Button } from '../../ui/Button';
import { FactCard } from '../../ui/FactCard';
import { RoundProgress } from '../../ui/RoundProgress';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { Stars } from '../../ui/Stars';
import { Theme } from '../../ui/Theme';
import { TopBar } from '../../ui/TopBar';
import { Tweens, ease, lerp } from './anim';
import { Flask, Mortar } from './Mortar';
import { MirrorBand, fit, panel } from './parts';
import { PANEL, RecipePanel } from './RecipePanel';
import {
  RECIPES,
  basketComplete,
  pickResult,
  purity,
  spawnPlan,
  starsFor,
  verdict,
  type PickResult,
  type PlantId,
  type Recipe,
  type Spawn,
} from './rules';

type Phase = 'intro' | 'walk' | 'gathered' | 'grind' | 'pour' | 'result' | 'summary';

const ROUNDS = 3;
const GATHER_SECONDS = 40;
/** Parallax speeds in px/s while walking. */
const MID_SPEED = 60;
const NEAR_SPEED = 140;
/** The mid band's lower edge hides behind the opaque stony path of the near band. */
const MID_BOTTOM = 960;
/**
 * The near band is enlarged so its grass reaches up to the farthest lane (y 700) and its stony path
 * runs under the Laborant's feet; at scale 1 the top lane would float in front of the forest.
 */
const NEAR_SCALE = 1.35;
/** Plants ride in from the right, past the Laborant, and leave on the left in PLANT_TRAVEL s. */
const PLANT_FROM = 2000;
const PLANT_TO = -200;
const PLANT_TRAVEL = 14;
const PLANT_SPEED = (PLANT_FROM - PLANT_TO) / PLANT_TRAVEL;
const LANE_Y = [700, 800, 900] as const;
/** Farther lanes are drawn a little smaller. */
const LANE_SCALE = [0.86, 0.95, 1.05] as const;
const PLANT_BOX = { w: 210, h: 230 };
const PLANT_HIT = { w: 160, h: 200 };
const LABORANT = { x: 420, y: 760, h: 420, frame: 0.3, bob: 6, hop: 46 };
const BASKET = { x: 215, bottom: 1010, w: 190 };
const FLY_SECONDS = 0.4;
const FLASH_SECONDS = 0.2;
/** Order of the "did you know" facts: the dziewięćsił one goes with the bruise recipe. */
const FACT_QUEUE = [0, 1, 3];
const FACT_BY_RECIPE: Partial<Record<Recipe['id'], number>> = { stluczenia: 2 };

interface LivePlant {
  id: PlantId;
  view: Container;
  art: Sprite;
  shadow: Graphics;
  lane: Spawn['lane'];
  sway: number;
  done: boolean;
}

interface RoundResult {
  recipe: Recipe;
  stars: 1 | 2 | 3;
}

interface HerbsDebug {
  readonly phase: Phase;
  readonly round: number;
  readonly plants: { id: PlantId; x: number; y: number; needed: boolean }[];
  readonly mortar: { x: number; y: number; r: number } | null;
}

/**
 * Laborant: an 18th-century Karpacz herbalist walks up a morning slope. Each of 3 recipes: tap only
 * the plants on the recipe as they pass (40 s), grind them in the mortar with a circling finger and
 * pour the remedy into a violet flask. Stars per recipe from basket purity and grinding time.
 */
export default class HerbsScene extends Scene {
  private readonly tweens = new Tweens();
  private readonly rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  private field = false;
  private phase: Phase = 'intro';

  // world
  private mid!: MirrorBand;
  private near!: MirrorBand;
  private readonly lanes = [new Container(), new Container(), new Container()];
  private readonly fly = new Container();
  private laborant!: Sprite;
  private frames: Texture[] = [];
  private basket!: Container;
  private basketArt!: Sprite;
  private basketFill!: Container;
  private readonly flash = new Graphics();

  // hud
  private bar!: TopBar;
  private progress!: RoundProgress;
  private recipePanel!: RecipePanel;
  private readonly overlay = new Container();

  // round state
  private readonly order: Recipe[] = shuffle(this.rng, RECIPES);
  private round = 0;
  private recipe: Recipe = RECIPES[0];
  private plan: Spawn[] = [];
  private nextSpawn = 0;
  private roundT = 0;
  private basketHerbs: PlantId[] = [];
  private picks: PickResult[] = [];
  private plants: LivePlant[] = [];
  private readonly results: RoundResult[] = [];
  private readonly factQueue = [...FACT_QUEUE];
  private mortar: Mortar | null = null;

  // walking
  private walking = false;
  private walkT = 0;
  private hop = 0;
  private t = 0;

  async init(params: Record<string, string>): Promise<void> {
    this.field = params.field === '1';
    const { assets } = this.ctx;
    await Promise.all([assets.loadGroup('herbs'), assets.loadGroup('glass')]);
    this.buildWorld();
    this.buildHud();
    this.publishDev();
  }

  enter(): void {
    const { audio } = this.ctx;
    audio.play('herbs.music', { loop: true, volume: 0.4 });
    audio.play('herbs.birds', { loop: true, volume: 0.3 });
    this.showIntro();
  }

  update(dt: number): void {
    this.t += dt;
    this.tweens.update(dt);
    if (this.walking) this.walk(dt);
    this.laborant.y = LABORANT.y + this.bob() - this.hop;
    this.mortar?.update(dt);
    if (this.phase === 'walk') this.gather(dt);
  }

  exit(): void {
    const { audio } = this.ctx;
    for (const m of ['herbs.music', 'herbs.birds', 'herbs.steps', 'herbs.grind']) audio.stop(m);
    this.mortar?.silence();
    this.tweens.clear();
    if (import.meta.env.DEV && window.__bk) delete (window.__bk as BkHerbs).herbs;
  }

  // ---------------------------------------------------------------- building

  private buildWorld(): void {
    const { assets } = this.ctx;
    const far = sprite(assets, 'herbs/bg_far', { w: DESIGN.w, h: DESIGN.h, tint: 0x9cc3b0 });
    this.mid = new MirrorBand(assets, 'herbs/strip_mid', { w: 2048, h: 640, tint: 0x7f9f86 });
    this.mid.y = MID_BOTTOM - this.mid.bandHeight;
    this.near = new MirrorBand(assets, 'herbs/strip_near', { w: 2048, h: 448, tint: 0xb9b48a }, NEAR_SCALE);
    this.near.y = DESIGN.h - this.near.bandHeight;

    this.frames = [assets.texture('herbs/laborant_1'), assets.texture('herbs/laborant_2')];
    this.laborant = fit(sprite(assets, 'herbs/laborant_1', { w: 240, h: LABORANT.h, tint: 0x8a7a66 }), 1000, LABORANT.h);
    this.laborant.anchor.set(0.5);
    this.laborant.position.set(LABORANT.x, LABORANT.y);

    this.basket = new Container();
    this.basketArt = fit(sprite(assets, 'herbs/basket', { w: 549, h: 512, tint: 0xb48a4e }), BASKET.w, 1000);
    this.basketArt.anchor.set(0.5, 1);
    this.basketFill = new Container();
    this.basket.addChild(this.basketFill, this.basketArt);
    this.basket.position.set(BASKET.x, BASKET.bottom);

    const shadow = new Graphics()
      .ellipse(LABORANT.x - 10, LABORANT.y + LABORANT.h / 2 - 6, 110, 16)
      .fill({ color: Theme.color.night, alpha: 0.22 })
      .ellipse(BASKET.x, BASKET.bottom - 4, BASKET.w * 0.48, 14)
      .fill({ color: Theme.color.night, alpha: 0.22 });

    this.flash.rect(0, 0, DESIGN.w, DESIGN.h).fill(Theme.color.bad);
    this.flash.alpha = 0;
    this.flash.eventMode = 'none';

    this.addChild(far, this.mid, this.near, ...this.lanes, shadow, this.basket, this.laborant, this.fly, this.flash);
  }

  private buildHud(): void {
    const { i18n, audio, kiosk, assets } = this.ctx;
    this.progress = new RoundProgress(ROUNDS, 360);
    this.progress.position.set((DESIGN.w - 360) / 2, TopBar.HEIGHT + 14);
    // a dark backing so the dim pills still read against the bright morning sky
    const pills = new Graphics()
      .roundRect(this.progress.x - 14, this.progress.y - 8, 360 + 28, 18 + 16, 17)
      .fill({ color: Theme.color.night, alpha: 0.55 });
    this.recipePanel = new RecipePanel(assets, i18n, this.tweens);
    this.recipePanel.position.set((DESIGN.w - PANEL.w) / 2, TopBar.HEIGHT + 46);
    this.recipePanel.visible = false;
    this.bar = new TopBar({
      title: i18n.t('herbs.title'),
      backLabel: i18n.t('ui.back'),
      onBack: () => this.ctx.go('hub'),
      audio,
      muteLabel: i18n.t('ui.mute'),
      kiosk,
    });
    this.addChild(pills, this.progress, this.recipePanel, this.overlay, this.bar);
  }

  // ---------------------------------------------------------------- intro

  private showIntro(): void {
    const { i18n, assets } = this.ctx;
    this.phase = 'intro';
    const dim = this.dim(0.35);
    const bubble = new SpeechBubble({
      portrait: assets.texture('glass/portrait_laborant'),
      name: i18n.t('herbs.intro.h'),
      text: i18n.t('herbs.intro.p'),
      width: 1160,
    });
    bubble.position.set((DESIGN.w - 1160) / 2, 300);
    const start = this.button(i18n.t('herbs.intro.start'), 'herbs.start', () => this.startRound(0));
    start.position.set((DESIGN.w - start.box.w) / 2, bubble.y + bubble.height + 48);
    this.overlay.addChild(dim, bubble, start);
    this.fadeIn(this.overlay);
  }

  // ---------------------------------------------------------------- gathering

  private startRound(i: number): void {
    const { i18n } = this.ctx;
    this.clearOverlay();
    this.round = i;
    this.recipe = this.order[i];
    this.plan = spawnPlan(this.rng, this.recipe, GATHER_SECONDS);
    this.nextSpawn = 0;
    this.roundT = 0;
    this.basketHerbs = [];
    this.picks = [];
    this.basketFill.removeChildren().forEach((c) => c.destroy());
    this.progress.set(i);
    this.bar.setSubtitle(
      i18n.t('herbs.round.label', {
        n: i + 1,
        total: ROUNDS,
        name: i18n.t(`herbs.recipes.${this.recipe.id}.name`),
      }),
    );
    this.recipePanel.visible = true;
    this.recipePanel.show(this.recipe);
    this.phase = 'walk';
    this.setWalking(true);
  }

  private gather(dt: number): void {
    this.roundT += dt;
    while (this.nextSpawn < this.plan.length && this.plan[this.nextSpawn].t <= this.roundT) {
      this.spawn(this.plan[this.nextSpawn++]);
    }
    this.recipePanel.setTime(1 - this.roundT / GATHER_SECONDS);
    if (this.roundT >= GATHER_SECONDS) this.endGathering(true);
  }

  private spawn(s: Spawn): void {
    const view = new Container();
    view.position.set(PLANT_FROM, LANE_Y[s.lane]);
    const k = LANE_SCALE[s.lane];
    const art = fit(
      sprite(this.ctx.assets, `herbs/plant_${s.plant}`, { w: 200, h: 240, tint: 0x6d9a52 }),
      PLANT_BOX.w * k,
      PLANT_BOX.h * k,
    );
    art.anchor.set(0.5, 0.985);
    const shadow = new Graphics().ellipse(0, -2, art.width * 0.42, 12 * k).fill({ color: Theme.color.night, alpha: 0.2 });
    view.addChild(shadow, art);
    view.eventMode = 'static';
    view.cursor = 'pointer';
    view.hitArea = new Rectangle(-PLANT_HIT.w / 2, -PLANT_HIT.h - 6, PLANT_HIT.w, PLANT_HIT.h);
    const plant: LivePlant = { id: s.plant, view, art, shadow, lane: s.lane, sway: this.rng() * Math.PI * 2, done: false };
    view.on('pointerdown', () => this.tapPlant(plant));
    this.lanes[s.lane].addChild(view);
    this.plants.push(plant);
  }

  private movePlants(dt: number): void {
    for (const p of this.plants) {
      p.view.x -= PLANT_SPEED * dt;
      p.art.rotation = Math.sin(this.t * 1.8 + p.sway) * 0.035;
    }
    const gone = this.plants.filter((p) => p.view.x < PLANT_TO);
    if (gone.length === 0) return;
    for (const p of gone) p.view.destroy({ children: true });
    this.plants = this.plants.filter((p) => !gone.includes(p));
  }

  private tapPlant(plant: LivePlant): void {
    if (this.phase !== 'walk' || plant.done) return;
    const result = pickResult(this.basketHerbs, plant.id, this.recipe);
    this.picks.push(result);
    if (result === 'wrong' || result === 'decoy') {
      this.ctx.audio.play('herbs.sneeze');
      this.sneeze(plant);
      return;
    }
    this.ctx.audio.play('herbs.pluck');
    if (result === 'needed') {
      this.basketHerbs.push(plant.id);
      this.recipePanel.tick(plant.id);
    }
    this.flyToBasket(plant);
    if (result === 'needed' && basketComplete(this.basketHerbs, this.recipe)) this.endGathering(false);
  }

  /** The plant leaves the ground and arcs into the basket. */
  private flyToBasket(plant: LivePlant): void {
    plant.done = true;
    this.plants = this.plants.filter((p) => p !== plant);
    const view = plant.view;
    view.eventMode = 'none';
    this.fly.addChild(view);
    const from = { x: view.x, y: view.y - plant.art.height * 0.4 };
    view.position.set(from.x, from.y);
    plant.art.anchor.set(0.5, 0.5);
    plant.shadow.visible = false;
    const to = { x: BASKET.x, y: BASKET.bottom - this.basketArt.height * 0.55 };
    const ctrl = { x: lerp(from.x, to.x, 0.5), y: Math.min(from.y, to.y) - 280 };
    const s0 = view.scale.x;
    this.tweens.add({
      dur: FLY_SECONDS,
      targets: [view],
      update: (p) => {
        const e = ease.inOutSine(p);
        view.position.set(bezier(from.x, ctrl.x, to.x, e), bezier(from.y, ctrl.y, to.y, e));
        view.scale.set(lerp(s0, s0 * 0.4, e));
        view.rotation = -0.9 * e;
      },
      done: () => {
        view.destroy({ children: true });
        this.addToBasket(plant.id);
      },
    });
  }

  /** A sprig peeks out of the basket and the basket squashes. */
  private addToBasket(id: PlantId): void {
    const n = this.basketFill.children.length;
    if (n < 7) {
      const sprig = fit(sprite(this.ctx.assets, `herbs/plant_${id}`, { w: 200, h: 240, tint: 0x6d9a52 }), 90, 90);
      sprig.anchor.set(0.5, 0.9);
      sprig.position.set(((n * 37) % 110) - 55, -this.basketArt.height * 0.5);
      sprig.rotation = ((n % 3) - 1) * 0.28;
      this.basketFill.addChild(sprig);
    }
    this.tweens.add({
      dur: 0.3,
      targets: [this.basket],
      update: (p) => {
        const s = Math.sin(p * Math.PI);
        this.basket.scale.set(1 + s * 0.08, 1 - s * 0.1);
      },
    });
  }

  /** Wrong plant: sneeze, red flash, the Laborant hops; the plant shakes its head and wilts. */
  private sneeze(plant: LivePlant): void {
    plant.done = true;
    plant.view.eventMode = 'none';
    this.flash.alpha = 0.38;
    this.tweens.add({ dur: FLASH_SECONDS, targets: [this.flash], update: (p) => (this.flash.alpha = 0.38 * (1 - p)) });
    this.tweens.add({ dur: 0.36, update: (p) => (this.hop = Math.sin(p * Math.PI) * LABORANT.hop) });
    this.tweens.add({
      dur: 0.5,
      targets: [plant.view],
      update: (p) => {
        plant.view.rotation = Math.sin(p * Math.PI * 6) * 0.12 * (1 - p);
        plant.view.alpha = 1 - p * 0.6;
      },
    });
    plant.art.tint = 0x9a9a8a;

    const text = new Text({
      text: this.ctx.i18n.t('herbs.sneeze'),
      style: {
        fontFamily: Theme.font.display,
        fontWeight: '900',
        fontSize: 48,
        fill: Theme.color.paper,
        stroke: { color: Theme.color.ink, width: 8, join: 'round' },
      },
    });
    text.anchor.set(0.5);
    text.position.set(LABORANT.x + 120, LABORANT.y - LABORANT.h / 2 - 10);
    this.fly.addChild(text);
    this.tweens.add({
      dur: 0.9,
      targets: [text],
      update: (p) => {
        text.scale.set(ease.outBack(Math.min(1, p * 3)));
        text.y = LABORANT.y - LABORANT.h / 2 - 10 - p * 50;
        text.alpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      },
      done: () => text.destroy(),
    });
  }

  private endGathering(timeUp: boolean): void {
    this.phase = 'gathered';
    this.setWalking(false);
    for (const p of this.plants) {
      p.done = true;
      p.view.eventMode = 'none';
    }
    const fading = this.plants;
    this.plants = [];
    this.tweens.add({
      dur: 0.5,
      delay: 0.2,
      targets: fading.map((pl) => pl.view),
      update: (p) => fading.forEach((pl) => (pl.view.alpha = Math.min(pl.view.alpha, 1 - p))),
      done: () => fading.forEach((pl) => pl.view.destroy({ children: true })),
    });
    if (timeUp) this.toast(this.ctx.i18n.t('herbs.round.timeUp'), 1.8);
    this.tweens.after(timeUp ? 2 : FLY_SECONDS + 0.6, () => this.startGrind());
  }

  private setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.walking = on;
    if (on) this.ctx.audio.play('herbs.steps', { loop: true, volume: 0.25 });
    else {
      this.ctx.audio.stop('herbs.steps');
      this.laborant.texture = this.frames[0];
    }
  }

  private walk(dt: number): void {
    this.walkT += dt;
    this.mid.scroll(MID_SPEED * dt);
    this.near.scroll(NEAR_SPEED * dt);
    this.laborant.texture = this.frames[Math.floor(this.walkT / LABORANT.frame) % 2];
    this.movePlants(dt);
  }

  private bob(): number {
    return this.walking ? -Math.abs(Math.sin((this.walkT / LABORANT.frame) * Math.PI)) * LABORANT.bob * 2 + LABORANT.bob : 0;
  }

  // ---------------------------------------------------------------- mortar

  private startGrind(): void {
    const { i18n, assets, audio } = this.ctx;
    this.phase = 'grind';
    this.recipePanel.visible = false;
    const dim = this.dim(0.62);
    const head = this.heading(i18n.t('herbs.grind.h'), 168);
    const hint = new Text({ text: i18n.t('herbs.grind.p'), style: Theme.text.body(32, Theme.color.emberSoft) });
    hint.anchor.set(0.5, 0);
    hint.position.set(DESIGN.w / 2, 244);
    const flask = new Flask(assets, 300);
    flask.position.set(1500, 990);
    const mortar = new Mortar(assets, audio, this.recipe.herbs.filter((h) => this.basketHerbs.includes(h)));
    mortar.position.set(DESIGN.w / 2, 700);
    mortar.onGround = (seconds, timedOut) => {
      // the heading and hint fade out for the pour: the time-up line takes their place
      if (timedOut) this.toast(i18n.t('herbs.grind.timeUp'), 2, hint.y + 20);
      this.pour(mortar, flask, seconds, [head, hint]);
    };
    this.mortar = mortar;
    this.overlay.addChild(dim, head, hint, flask, mortar);
    this.fadeIn(this.overlay);
  }

  private pour(mortar: Mortar, flask: Flask, grindSeconds: number, texts: Text[]): void {
    this.phase = 'pour';
    this.tweens.add({ dur: 0.3, targets: texts, update: (p) => texts.forEach((t) => (t.alpha = 1 - p)) });
    mortar.pour(this.tweens, flask, () => this.showResult(mortar, flask, grindSeconds));
  }

  private showResult(mortar: Mortar, flask: Flask, grindSeconds: number): void {
    const { i18n, audio } = this.ctx;
    this.phase = 'result';
    const got = this.recipe.herbs.filter((h) => this.basketHerbs.includes(h)).length;
    const score = purity(this.picks) * (got / this.recipe.herbs.length);
    const stars = starsFor(score, grindSeconds);
    this.results.push({ recipe: this.recipe, stars });
    this.progress.set(this.round + 1);
    audio.play('ui.success', { volume: 0.8 });

    // the result card: the flask stands in its left column, the text in the right one
    const W = 1440;
    const SIDE = 380;
    const colW = W - SIDE - 40;
    const cx = SIDE + colW / 2;
    const card = new Container();
    const title = new Text({ text: i18n.t('herbs.round.done'), style: Theme.text.title(64) });
    title.anchor.set(0.5, 0);
    title.position.set(cx, 36);
    const name = new Text({
      text: i18n.t(`herbs.recipes.${this.recipe.id}.name`),
      style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 32, fill: Theme.color.emberSoft },
    });
    name.anchor.set(0.5, 0);
    name.position.set(cx, 118);
    const row = new Stars(3, 84);
    row.position.set(cx - row.width / 2, 176);
    row.onStar = () => audio.play('ui.star');
    const why = new Text({
      text: this.verdictLine(grindSeconds),
      style: { fontFamily: Theme.font.body, fontWeight: '700', fontSize: 28, fill: Theme.color.paper },
    });
    why.anchor.set(0.5, 0);
    why.position.set(cx, 276);
    if (why.width > colW) why.scale.set(colW / why.width);
    const fact = new FactCard(i18n.t('ui.didYouKnow'), this.nextFact(this.recipe.id), colW);
    fact.position.set(SIDE, 340);
    const last = this.round + 1 >= ROUNDS;
    const next = this.button(i18n.t('ui.next'), 'herbs.next', () => {
      if (last) this.showSummary();
      else this.startRound(this.round + 1);
    });
    next.position.set(cx - next.box.w / 2, fact.y + fact.height + 36);
    const h = next.y + next.box.h + 40;
    card.addChild(panel(W, h, 0.92), title, name, row, why, fact, next);
    card.position.set((DESIGN.w - W) / 2, Math.max(TopBar.HEIGHT + 60, (DESIGN.h - h) / 2 + 40));
    card.alpha = 0;
    // no taps until the card has faded in: an early "next" would clear it under its own tweens
    card.interactiveChildren = false;
    this.overlay.addChild(card, flask); // the flask stays in front of the card

    // the bowl steps back, the flask comes over into the card
    this.tweens.add({
      dur: 0.4,
      targets: [mortar],
      update: (p) => (mortar.alpha = 1 - p),
      done: () => {
        mortar.destroy({ children: true });
        if (this.mortar === mortar) this.mortar = null;
      },
    });
    const from = { x: flask.x, y: flask.y };
    const to = { x: card.x + SIDE / 2 + 10, y: card.y + h - 48 };
    this.tweens.add({
      dur: 0.6,
      targets: [flask],
      update: (p) => {
        const e = ease.outCubic(p);
        flask.position.set(lerp(from.x, to.x, e), lerp(from.y, to.y, e));
        flask.scale.set(lerp(1, 1.3, e));
      },
    });
    this.tweens.add({
      dur: 0.35,
      delay: 0.3,
      targets: [card, row],
      update: (p) => (card.alpha = p),
      done: () => {
        card.interactiveChildren = true;
        row.set(stars);
      },
    });
  }

  /** One line under the stars: what was missing, how many slips, or that grinding was slow. */
  private verdictLine(grindSeconds: number): string {
    const { i18n } = this.ctx;
    const v = verdict(this.basketHerbs, this.picks, this.recipe, grindSeconds);
    if (v === 'missing') {
      const list = this.recipe.herbs
        .filter((h) => !this.basketHerbs.includes(h))
        .map((h) => i18n.t(`herbs.plants.${h}`))
        .join(', ');
      return i18n.t('herbs.round.missing', { list });
    }
    const slips = this.picks.filter((p) => p === 'wrong' || p === 'decoy').length;
    return i18n.t(`herbs.round.${v}`, { n: slips });
  }

  /** The recipe's own fact if it has one, else the next unused one (the summary passes null). */
  private nextFact(recipe: Recipe['id'] | null): string {
    const facts = this.ctx.i18n.get<string[]>('herbs.facts');
    const own = recipe ? FACT_BY_RECIPE[recipe] : undefined;
    const index = own ?? this.factQueue.shift() ?? 0;
    return facts[index] ?? '';
  }

  // ---------------------------------------------------------------- summary

  private showSummary(): void {
    const { i18n, audio, assets, save } = this.ctx;
    this.clearOverlay();
    this.phase = 'summary';
    this.recipePanel.visible = false;
    this.bar.setSubtitle('');
    const mean = this.results.reduce((a, r) => a + r.stars, 0) / Math.max(1, this.results.length);
    const total = Math.max(1, Math.min(3, Math.round(mean)));
    save.record('herbs', total, this.field);

    const dim = this.dim(0.7);
    const head = this.heading(i18n.t('herbs.sum.h'), 150);
    const title = new Text({
      text: i18n.t(`herbs.titles.${total}`),
      style: { fontFamily: Theme.font.display, fontWeight: '900', fontSize: 76, fill: Theme.color.ember },
    });
    title.anchor.set(0.5, 0);
    title.position.set(DESIGN.w / 2, 220);
    const stars = new Stars(3, 64);
    stars.position.set((DESIGN.w - stars.width) / 2, 322);
    stars.onStar = () => audio.play('ui.star');
    this.overlay.addChild(dim, head, title, stars);

    // the three remedies on a shelf
    const SHELF_Y = 592;
    const shelf = new Graphics()
      .roundRect(DESIGN.w / 2 - 470, SHELF_Y - 2, 940, 18, 9)
      .fill({ color: 0x6b4a2e })
      .roundRect(DESIGN.w / 2 - 470, SHELF_Y + 12, 940, 8, 4)
      .fill({ color: Theme.color.night, alpha: 0.4 });
    this.overlay.addChild(shelf);
    this.results.forEach((r, i) => {
      const cx = DESIGN.w / 2 + (i - 1) * 300;
      const flask = new Flask(assets, 180);
      flask.position.set(cx, SHELF_Y);
      flask.setLevel(1);
      const label = new Text({
        text: i18n.t(`herbs.recipes.${r.recipe.id}.name`),
        style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 26, fill: Theme.color.paper },
      });
      label.anchor.set(0.5, 0);
      label.position.set(cx, SHELF_Y + 28);
      const mini = new Stars(3, 30);
      mini.position.set(cx - mini.width / 2, SHELF_Y + 66);
      mini.set(r.stars, false);
      this.overlay.addChild(flask, label, mini);
    });

    const fact = new FactCard(i18n.t('ui.didYouKnow'), this.nextFact(null), 1000);
    fact.position.set((DESIGN.w - 1000) / 2, SHELF_Y + 118);
    const again = this.button(i18n.t('ui.again'), 'herbs.again', () =>
      this.ctx.go('game:herbs', this.field ? { field: '1' } : {}),
    );
    const back = this.button(i18n.t('ui.back'), 'herbs.back', () => this.ctx.go('hub'), 'quiet');
    const gap = 32;
    const rowW = again.box.w + gap + back.box.w;
    const by = fact.y + fact.height + 24;
    again.position.set((DESIGN.w - rowW) / 2, by);
    back.position.set(again.x + again.box.w + gap, by);
    this.overlay.addChild(fact, again, back);
    this.fadeIn(this.overlay);
    this.tweens.after(0.4, () => stars.set(total), [stars]);
  }

  // ---------------------------------------------------------------- helpers

  private button(label: string, name: string, onPress: () => void, variant: 'primary' | 'quiet' = 'primary'): Button {
    return new Button(label, {
      name,
      variant,
      kiosk: this.ctx.kiosk,
      onTap: () => this.ctx.audio.play('ui.tap'),
      onPress,
    });
  }

  private dim(alpha: number): Graphics {
    const g = new Graphics().rect(0, 0, DESIGN.w, DESIGN.h).fill({ color: Theme.color.night, alpha });
    // swallows taps meant for the world underneath
    g.eventMode = 'static';
    return g;
  }

  private heading(text: string, y: number): Text {
    const t = new Text({ text, style: Theme.text.title(60) });
    t.anchor.set(0.5, 0);
    t.position.set(DESIGN.w / 2, y);
    return t;
  }

  private toast(text: string, seconds: number, y = 470): void {
    const style = Theme.text.body(34);
    style.fontWeight = '800';
    style.align = 'center';
    const t = new Text({ text, style });
    t.anchor.set(0.5);
    const box = panel(t.width + 80, t.height + 44, 0.9);
    box.position.set(-(t.width + 80) / 2, -(t.height + 44) / 2);
    const holder = new Container();
    holder.addChild(box, t);
    holder.position.set(DESIGN.w / 2, y);
    this.overlay.addChild(holder);
    this.tweens.add({
      dur: seconds,
      targets: [holder],
      update: (p) => {
        holder.alpha = p < 0.15 ? p / 0.15 : p > 0.8 ? (1 - p) / 0.2 : 1;
        holder.scale.set(p < 0.15 ? ease.outBack(p / 0.15) : 1);
      },
      done: () => holder.destroy({ children: true }),
    });
  }

  /** Fades `c` in; its children take taps only once it is fully shown. */
  private fadeIn(c: Container): void {
    c.alpha = 0;
    c.interactiveChildren = false;
    this.tweens.add({
      dur: 0.3,
      targets: [c],
      update: (p) => (c.alpha = p),
      done: () => (c.interactiveChildren = true),
    });
  }

  private clearOverlay(): void {
    if (this.mortar) {
      this.mortar.silence();
      this.mortar = null;
    }
    // tweens aimed at these objects drop themselves once they see them destroyed (anim.ts)
    this.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.overlay.alpha = 1;
  }

  /** Dev only: lets the smoke test tap the right plants and circle the mortar. */
  private publishDev(): void {
    if (!import.meta.env.DEV) return;
    const scene = this;
    const api: HerbsDebug = {
      get phase() {
        return scene.phase;
      },
      get round() {
        return scene.round;
      },
      get plants() {
        return scene.plants
          .filter((p) => !p.done && p.view.x > 0 && p.view.x < DESIGN.w)
          .map((p) => {
            const c = p.view.toGlobal(new Point(0, -PLANT_HIT.h / 2 - 6));
            return {
              id: p.id,
              x: c.x,
              y: c.y,
              needed: pickResult(scene.basketHerbs, p.id, scene.recipe) === 'needed',
            };
          });
      },
      get mortar() {
        return scene.mortar && !scene.mortar.destroyed ? scene.mortar.devTarget() : null;
      },
    };
    const bk = (window.__bk ??= { sceneId: null }) as BkHerbs;
    bk.herbs = api;
  }
}

type BkHerbs = NonNullable<Window['__bk']> & { herbs?: HerbsDebug };

function bezier(a: number, c: number, b: number, t: number): number {
  return (1 - t) ** 2 * a + 2 * (1 - t) * t * c + t * t * b;
}
