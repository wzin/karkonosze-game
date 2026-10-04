import { Container, Graphics, Rectangle, Text, type Texture } from 'pixi.js';
import { sprite } from '../../core/Assets';
import { WeatherFilter } from '../../core/fx/WeatherFilter';
import { DESIGN } from '../../core/Layout';
import { mulberry32 } from '../../core/Rng';
import { Scene } from '../../core/Scene';
import { Button } from '../../ui/Button';
import { FactCard } from '../../ui/FactCard';
import { RoundProgress } from '../../ui/RoundProgress';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { Stars } from '../../ui/Stars';
import { Theme } from '../../ui/Theme';
import { TopBar } from '../../ui/TopBar';
import { AnswerTile, TILE } from './AnswerTile';
import { Clock, easeInBack, easeInOutSine, easeOutBack, easeOutCubic, linear } from './anim';
import { Emma, EMMA_EXIT, EMMA_PATH, type Point } from './Emma';
import { FieldSlot } from './Field';
import { ROUNDS, answerOptions, fieldSlots, planWave, roundConfig, starsFor, type Pop, type Weather } from './rules';

/** Seconds to pick an answer; after that the round counts as wrong. */
const ANSWER_LIMIT = 8;
const POP_S = 0.25;
const HIDE_S = 0.2;
const STAGGER_S = 0.07;
const REVEAL_S = 1.2;
const WEATHER_CHANGE_S = 1;
const EMMA_RUN_S = 1.6;
const EMMA_EXIT_S = 2.4;
/** Rain is faint at 0.7, so it gets the full strength. */
const WEATHER_INTENSITY: Record<Weather, number> = { 0: 0, 1: 0.7, 2: 1, 3: 0.7, 4: 0.7 };
/** Question, result and fact live in the open sky right of the hill, clear of the chapel and Emma. */
const PANEL = { cx: 1240, y: 168, w: 980 };
const TILE_GAP = 40;
const CARD = { w: 1000, pad: 44 };
const GRAVITY = 1500;

interface Speck {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

interface Question {
  panel: Container;
  heading: Text;
  tiles: AnswerTile[];
  timer: Graphics;
  timerW: number;
}

/**
 * Liczyrzepa i księżniczka Emma: the player is the Mountain Spirit counting turnips that pop out of
 * the field on Śnieżka, five rounds, a new weather each round, while Emma escapes down the path.
 * The flow is one async sequence on the scene's Clock; exit() clears the clock and the flow stops.
 */
export default class TurnipsScene extends Scene {
  private readonly clock = new Clock();
  private readonly rng = mulberry32(Math.floor(Math.random() * 2 ** 32));
  private readonly weather = new WeatherFilter();
  private readonly world = new Container();
  private readonly dirt = new Container();
  private readonly flash = new Graphics();
  private readonly hud = new Container();
  private readonly specks: Speck[] = [];
  private slots: FieldSlot[] = [];
  private emma!: Emma;
  private bar!: TopBar;
  private progress!: RoundProgress;
  private portrait!: Texture;
  private params: Record<string, string> = {};
  private time = 0;
  private correctRounds = 0;

  async init(params: Record<string, string>): Promise<void> {
    this.params = params;
    const { assets, i18n, audio, kiosk } = this.ctx;
    // the Spirit's portrait is shared with the glassworks
    await Promise.all([assets.loadGroup('turnips'), assets.loadGroup('glass')]);
    this.portrait = assets.texture('glass/portrait_duch');

    const bg = sprite(assets, 'turnips/bg', { w: DESIGN.w, h: DESIGN.h, tint: 0x5f7a6a });
    bg.width = DESIGN.w;
    bg.height = DESIGN.h;
    this.emma = new Emma(assets);
    this.emma.place(EMMA_PATH[0]);
    // back row first, so nearer mounds overlap the ones behind
    this.slots = fieldSlots().map((p, i) => new FieldSlot(assets, p.x, p.y, i * 1.7));
    const field = new Container();
    field.addChild(...this.slots);
    this.world.addChild(bg, this.emma, field, this.dirt);
    this.weather.mode = 0;
    this.weather.intensity = 0;
    this.world.filters = [this.weather];
    this.world.filterArea = new Rectangle(0, 0, DESIGN.w, DESIGN.h);

    this.flash.rect(0, 0, DESIGN.w, DESIGN.h).fill(0xf4f6ff);
    this.flash.alpha = 0;
    this.flash.visible = false;

    this.bar = new TopBar({
      title: this.t('title'),
      backLabel: i18n.t('ui.back'),
      onBack: () => this.ctx.go('hub'),
      audio,
      muteLabel: i18n.t('ui.mute'),
      kiosk,
    });
    this.progress = new RoundProgress(ROUNDS, 520);
    this.progress.position.set((DESIGN.w - 520) / 2, TopBar.HEIGHT + 18);
    this.progress.set(0);

    this.addChild(this.world, this.flash, this.hud, this.bar, this.progress);
    this.showIntro();
  }

  enter(): void {
    this.ctx.audio.play('turnips.music', { loop: true, volume: 0.4 });
    this.ctx.audio.play('turnips.wind', { loop: true, volume: 0.3 });
  }

  update(dt: number): void {
    this.time += dt;
    this.clock.update(dt);
    this.weather.time = this.time;
    this.emma.update(dt);
    for (const slot of this.slots) slot.sway(this.time);
    this.updateSpecks(dt);
  }

  exit(): void {
    this.clock.clear();
    const { audio } = this.ctx;
    audio.stop('turnips.music');
    audio.stop('turnips.wind');
    audio.stop('turnips.steps');
    exposeAnswer(null);
  }

  // ── flow ────────────────────────────────────────────────────────────────

  private showIntro(): void {
    const heading = new Text({ text: this.t('intro.h'), style: Theme.text.title(72) });
    const storyStyle = bodyStyle(30);
    storyStyle.align = 'center';
    const story = new Text({ text: this.t('intro.p'), style: storyStyle });
    const bubble = new SpeechBubble({
      portrait: this.portrait,
      name: this.t('spirit'),
      text: this.t('intro.line'),
      width: CARD.w,
    });
    const start = new Button(this.t('intro.start'), {
      name: 'turnips.start',
      kiosk: this.ctx.kiosk,
      width: 360,
      onTap: () => this.ctx.audio.play('ui.tap'),
      onPress: () => {
        start.enabled = false;
        this.play(card).catch((err: unknown) => console.error('[turnips]', err));
      },
    });
    const card = this.card([
      { view: heading },
      { view: story, gap: 18 },
      { view: bubble, gap: 30 },
      { view: start, gap: 36 },
    ]);
    this.hud.addChild(card);
    void this.fadeIn(card);
  }

  private async play(intro: Container): Promise<void> {
    await this.fadeOut(intro);
    for (let round = 1; round <= ROUNDS; round++) {
      if (await this.playRound(round)) this.correctRounds++;
    }
    await this.showSummary();
  }

  /** @returns true when the player counted right. */
  private async playRound(round: number): Promise<boolean> {
    const wave = roundConfig(round);
    this.progress.set(round - 1);
    this.bar.setSubtitle(`${this.t('round.n', { n: round, total: ROUNDS })} · ${this.t(`weather.${wave.weather}`)}`);
    await Promise.all([this.changeWeather(wave.weather), this.showBanner(this.t('round.h'))]);

    const plan = planWave(this.rng, wave, this.slots.length);
    for (let g = 0; g < plan.length; g++) {
      await this.popGroup(plan[g], wave.showMs / 1000);
      if (g < plan.length - 1) await this.clock.wait(wave.gapMs / 1000);
    }
    await this.clock.wait(0.3);

    const options = answerOptions(this.rng, wave.count);
    const correct = options.indexOf(wave.count);
    const q = this.buildQuestion(options);
    // the tiles take answers (and the clock runs) from the moment the panel starts to appear
    const answer = this.ask(q);
    exposeAnswer({ correct, count: wave.count });
    void this.fadeIn(q.panel);
    const picked = await answer;
    const ok = picked === correct;

    q.tiles.forEach((tile, i) => tile.mark(i === correct ? 'right' : i === picked ? 'wrong' : 'faded'));
    q.heading.style.fill = ok ? Theme.color.star : Theme.color.emberSoft;
    if (ok) {
      q.heading.text = this.t('round.correct');
      this.ctx.audio.play('turnips.correct');
      this.starFlash(q, correct);
      await this.clock.wait(1.1);
    } else {
      q.heading.text = this.t(picked === null ? 'round.late' : 'round.wrong', { n: wave.count });
      this.ctx.audio.play('turnips.wrong');
      await this.clock.wait(0.3);
      await this.reveal(plan);
    }
    this.progress.set(round);
    await this.fadeOut(q.panel);

    // Emma slips one step further down while the Spirit was busy
    const run = this.moveEmma(EMMA_PATH[Math.min(round, EMMA_PATH.length - 1)], EMMA_RUN_S);
    if (round < ROUNDS) await Promise.all([run, this.showFact(round)]);
    else await run;
    return ok;
  }

  private async showSummary(): Promise<void> {
    const { audio, i18n, kiosk, save } = this.ctx;
    const stars = starsFor(this.correctRounds);
    save.record('turnips', stars, this.params.field === '1');
    this.bar.setSubtitle('');
    exposeAnswer(null);
    // the summary card has its own stars and needs the room under the top bar
    void this.clock.tween(0.3, (k) => (this.progress.alpha = 1 - k)).then(() => (this.progress.visible = false));

    void this.changeWeather(0);
    await this.moveEmma(EMMA_EXIT, EMMA_EXIT_S);
    this.emma.visible = false;
    audio.play('turnips.grumble');
    await this.clock.wait(0.5);

    const heading = new Text({ text: this.t('sum.h'), style: Theme.text.title(64) });
    const titleStyle = Theme.text.title(42);
    titleStyle.fill = Theme.color.star;
    const title = new Text({ text: this.t(`titles.${stars}`), style: titleStyle });
    const starRow = new Stars(3, 76);
    starRow.onStar = () => audio.play('ui.star');
    const score = new Text({
      text: this.t('sum.score', { n: this.correctRounds, total: ROUNDS }),
      style: bodyStyle(26, Theme.color.emberSoft),
    });
    const bubble = new SpeechBubble({
      portrait: this.portrait,
      name: this.t('spirit'),
      text: this.t('sum.line'),
      width: CARD.w,
    });
    const fact = new FactCard(i18n.t('ui.didYouKnow'), this.fact(0), CARD.w);
    const again = new Button(this.t('again'), {
      name: 'turnips.again',
      kiosk,
      onTap: () => audio.play('ui.tap'),
      onPress: () => this.ctx.go('game:turnips', this.params),
    });
    const back = new Button(i18n.t('ui.back'), {
      name: 'turnips.back',
      variant: 'quiet',
      kiosk,
      onTap: () => audio.play('ui.tap'),
      onPress: () => this.ctx.go('hub'),
    });
    const buttons = new Container();
    back.x = again.box.w + 32;
    buttons.addChild(again, back);

    const card = this.card([
      { view: heading },
      { view: title, gap: 6 },
      { view: starRow, gap: 16 },
      { view: score, gap: 12 },
      { view: bubble, gap: 22 },
      { view: fact, gap: 22 },
      { view: buttons, gap: 28 },
    ]);
    this.hud.addChild(card);
    await this.fadeIn(card);
    starRow.set(stars);
  }

  // ── the wave ────────────────────────────────────────────────────────────

  private async popGroup(group: Pop[], showSeconds: number): Promise<void> {
    await Promise.all(group.map((pop, i) => this.rise(this.slots[pop.slot], pop.stone, i * STAGGER_S)));
    await this.clock.wait(showSeconds);
    await Promise.all(group.map((pop) => this.sink(this.slots[pop.slot])));
  }

  /** After a wrong answer: every turnip of the wave at once, so the player can count them again. */
  private async reveal(plan: Pop[][]): Promise<void> {
    const turnips = plan.flat().filter((p) => !p.stone);
    await Promise.all(turnips.map((pop, i) => this.rise(this.slots[pop.slot], false, i * 0.03, i % 3 === 0)));
    await this.clock.wait(REVEAL_S);
    await Promise.all(turnips.map((pop) => this.sink(this.slots[pop.slot])));
  }

  private async rise(slot: FieldSlot, stone: boolean, delay: number, sound = true): Promise<void> {
    if (delay > 0) await this.clock.wait(delay);
    slot.hold(stone ? 'stone' : 'turnip');
    if (sound) this.ctx.audio.play('turnips.pop', { volume: 0.8, rate: stone ? 0.7 : 0.9 + Math.random() * 0.3 });
    this.spray(slot);
    await this.clock.tween(POP_S, (k) => (slot.lift = k), easeOutBack);
  }

  private async sink(slot: FieldSlot): Promise<void> {
    await this.clock.tween(HIDE_S, (k) => (slot.lift = 1 - k), easeInBack);
    slot.lift = 0;
  }

  /** A puff of soil out of the mound's hole. */
  private spray(slot: FieldSlot): void {
    const { x, y, scale } = slot.hole;
    for (let i = 0; i < 7; i++) {
      const r = (2.5 + Math.random() * 3.5) * scale;
      const g = new Graphics().circle(0, 0, r).fill(i % 3 === 0 ? 0x5a4632 : 0x2c2622);
      g.position.set(x + (Math.random() - 0.5) * 34 * scale, y - 6 * scale);
      this.dirt.addChild(g);
      this.specks.push({
        g,
        vx: (Math.random() - 0.5) * 380 * scale,
        vy: -(240 + Math.random() * 220) * scale,
        life: 0,
        max: 0.4 + Math.random() * 0.2,
      });
    }
  }

  private updateSpecks(dt: number): void {
    for (let i = this.specks.length - 1; i >= 0; i--) {
      const s = this.specks[i];
      s.life += dt;
      s.vy += GRAVITY * dt;
      s.g.x += s.vx * dt;
      s.g.y += s.vy * dt;
      s.g.alpha = Math.max(0, 1 - s.life / s.max);
      if (s.life >= s.max) {
        s.g.destroy();
        this.specks.splice(i, 1);
      }
    }
  }

  // ── question and answer ─────────────────────────────────────────────────

  private buildQuestion(options: number[]): Question {
    const { audio, kiosk } = this.ctx;
    const panel = new Container();
    const rowW = TILE.w * options.length + TILE_GAP * (options.length - 1);
    const tilesY = 118;
    const timerY = tilesY + TILE.h + 30;
    const h = timerY + 16 + 34;
    panel.addChild(panelBackground(PANEL.w, h));

    const heading = new Text({ text: this.t('round.q'), style: Theme.text.title(50) });
    heading.anchor.set(0.5, 0);
    heading.position.set(PANEL.w / 2, 30);
    panel.addChild(heading);

    const x0 = (PANEL.w - rowW) / 2;
    const tiles = options.map((value, i) => {
      const tile = new AnswerTile(value, {
        name: `turnips.answer.${i}`,
        kiosk,
        onTap: () => audio.play('ui.tap'),
      });
      tile.position.set(x0 + i * (TILE.w + TILE_GAP), tilesY);
      panel.addChild(tile);
      return tile;
    });

    const timer = new Graphics();
    timer.position.set(x0, timerY);
    panel.addChild(timer);
    drawTimer(timer, rowW, 1);

    panel.position.set(PANEL.cx - PANEL.w / 2, PANEL.y);
    this.hud.addChild(panel);
    return { panel, heading, tiles, timer, timerW: rowW };
  }

  /** Resolves with the tile index, or null when the time runs out. Locks the tiles either way. */
  private ask(q: Question): Promise<number | null> {
    const owner = {};
    return new Promise((resolve) => {
      let settled = false;
      const settle = (i: number | null) => {
        if (settled) return;
        settled = true;
        this.clock.cancel(owner);
        q.timer.visible = false;
        for (const tile of q.tiles) tile.lock();
        resolve(i);
      };
      q.tiles.forEach((tile, i) => (tile.onPress = () => settle(i)));
      void this.clock
        .tween(ANSWER_LIMIT, (k) => drawTimer(q.timer, q.timerW, 1 - k), linear, owner)
        .then(() => settle(null));
    });
  }

  /** A star pops on the right tile's top corner. */
  private starFlash(q: Question, index: number): void {
    const size = 88;
    const star = new Stars(1, size);
    const tile = q.tiles[index];
    star.position.set(tile.x + TILE.w - size * 0.62, tile.y - size * 0.4);
    star.onStar = () => this.ctx.audio.play('ui.star');
    q.panel.addChild(star);
    star.set(1);
  }

  private async showFact(round: number): Promise<void> {
    const { audio, i18n, kiosk } = this.ctx;
    const box = new Container();
    const card = new FactCard(i18n.t('ui.didYouKnow'), this.fact(round), PANEL.w);
    let pressed: () => void = () => {};
    const done = new Promise<void>((resolve) => (pressed = resolve));
    const next = new Button(i18n.t('ui.next'), {
      name: 'turnips.next',
      kiosk,
      onTap: () => audio.play('ui.tap'),
      onPress: () => {
        next.enabled = false;
        pressed();
      },
    });
    next.position.set((PANEL.w - next.box.w) / 2, card.height + 24);
    box.addChild(card, next);
    box.position.set(PANEL.cx - PANEL.w / 2, PANEL.y);
    this.hud.addChild(box);
    await this.fadeIn(box);
    await done;
    await this.fadeOut(box);
  }

  // ── Emma, weather, banner ───────────────────────────────────────────────

  private async moveEmma(to: Point, seconds: number): Promise<void> {
    const emma = this.emma;
    const from = { x: emma.x, y: emma.y };
    emma.face(to.x >= from.x ? 1 : -1);
    emma.isRunning = true;
    this.ctx.audio.play('turnips.steps', { volume: 0.8 });
    await this.clock.tween(
      seconds,
      (k) => emma.place({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }),
      easeInOutSine,
    );
    emma.isRunning = false;
  }

  /** Fades the old weather out and the new one in, one second in all. Rain brings a thunderclap. */
  private async changeWeather(mode: Weather): Promise<void> {
    const w = this.weather;
    if (w.mode === mode) return;
    let left = WEATHER_CHANGE_S;
    if (w.mode !== 0) {
      const from = w.intensity;
      left /= 2;
      await this.clock.tween(left, (k) => (w.intensity = from * (1 - k)), easeInOutSine);
    }
    w.mode = mode;
    if (mode === 0) return;
    if (mode === 2) void this.lightning();
    const to = WEATHER_INTENSITY[mode];
    await this.clock.tween(left, (k) => (w.intensity = to * k), easeInOutSine);
  }

  private async lightning(): Promise<void> {
    const f = this.flash;
    this.ctx.audio.play('turnips.thunder');
    f.visible = true;
    await this.clock.tween(0.06, (k) => (f.alpha = 0.7 * k));
    await this.clock.tween(0.12, (k) => (f.alpha = 0.7 - 0.55 * k));
    await this.clock.tween(0.05, (k) => (f.alpha = 0.15 + 0.4 * k));
    await this.clock.tween(0.5, (k) => (f.alpha = 0.55 * (1 - k)), easeOutCubic);
    f.visible = false;
  }

  /** "Policz rzepy" grows in over the sky and fades away before the first group. */
  private async showBanner(text: string): Promise<void> {
    const label = new Text({ text, style: Theme.text.title(60) });
    label.anchor.set(0.5);
    const w = label.width + 96;
    const h = 112;
    const banner = new Container();
    banner.addChild(
      new Graphics()
        .roundRect(-w / 2, -h / 2 + 6, w, h, h / 2)
        .fill({ color: Theme.color.night, alpha: 0.35 })
        .roundRect(-w / 2, -h / 2, w, h, h / 2)
        .fill({ color: Theme.color.night, alpha: 0.82 })
        .stroke({ color: Theme.color.ember, alpha: 0.7, width: 3 }),
      label,
    );
    banner.position.set(PANEL.cx, PANEL.y + 140);
    banner.alpha = 0;
    this.hud.addChild(banner);
    await this.clock.tween(
      0.35,
      (k) => {
        banner.alpha = Math.min(k, 1);
        banner.scale.set(0.7 + 0.3 * k);
      },
      easeOutBack,
    );
    await this.clock.wait(0.9);
    await this.clock.tween(0.25, (k) => (banner.alpha = 1 - k));
    banner.destroy({ children: true });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.ctx.i18n.t(`turnips.${key}`, vars);
  }

  private fact(i: number): string {
    const facts = this.ctx.i18n.get<string[] | undefined>('turnips.facts') ?? [];
    return facts.length > 0 ? facts[i % facts.length] : '';
  }

  /** A dark card centred under the top bar, `items` stacked top to bottom and centred in it. */
  private card(items: { view: Container; gap?: number }[]): Container {
    const body = new Container();
    let y = 0;
    for (const { view, gap = 24 } of items) {
      if (body.children.length > 0) y += gap;
      body.addChild(view);
      const b = view.getLocalBounds();
      view.position.set((CARD.w - b.width) / 2 - b.x, y - b.y);
      y += b.height;
    }
    const w = CARD.w + CARD.pad * 2;
    const h = y + CARD.pad * 2;
    body.position.set(CARD.pad, CARD.pad);
    const card = new Container();
    card.addChild(panelBackground(w, h), body);
    const room = DESIGN.h - TopBar.HEIGHT;
    card.position.set((DESIGN.w - w) / 2, TopBar.HEIGHT + Math.max((room - h) / 2, 12));
    return card;
  }

  private async fadeIn(view: Container): Promise<void> {
    const y = view.y;
    view.alpha = 0;
    await this.clock.tween(
      0.3,
      (k) => {
        view.alpha = k;
        view.y = y + 24 * (1 - k);
      },
      easeOutCubic,
    );
  }

  private async fadeOut(view: Container): Promise<void> {
    await this.clock.tween(0.22, (k) => (view.alpha = 1 - k));
    view.destroy({ children: true });
  }
}

function bodyStyle(size: number, fill: number = Theme.color.paper) {
  const style = Theme.text.body(size, fill);
  style.wordWrapWidth = CARD.w;
  return style;
}

function panelBackground(w: number, h: number): Graphics {
  return new Graphics()
    .roundRect(0, 8, w, h, 32)
    .fill({ color: Theme.color.night, alpha: 0.4 })
    .roundRect(0, 0, w, h, 32)
    .fill({ color: Theme.color.night, alpha: 0.86 })
    .stroke({ color: Theme.color.ember, alpha: 0.55, width: 3 });
}

/** Time left as a bar that shrinks to the left and turns red for the last three seconds. */
function drawTimer(g: Graphics, w: number, left: number): void {
  const h = 16;
  const fill = left * ANSWER_LIMIT <= 3 ? Theme.color.bad : Theme.color.ember;
  g.clear().roundRect(0, 0, w, h, h / 2).fill({ color: Theme.color.paper, alpha: 0.18 });
  if (left > 0) g.roundRect(0, 0, Math.max(w * left, h), h, h / 2).fill(fill);
}

interface TurnipsHook {
  /** Index of the right tile: `window.__bk.buttons['turnips.answer.' + correct]`. */
  correct: number;
  /** How many turnips the wave had. */
  count: number;
}

/** Dev only: the current round's answer, so smoke tests can play a round right. */
function exposeAnswer(v: TurnipsHook | null): void {
  if (!import.meta.env.DEV) return;
  const bk = (window.__bk ??= { sceneId: null }) as NonNullable<Window['__bk']> & { turnips?: TurnipsHook };
  if (v) bk.turnips = v;
  else delete bk.turnips;
}
