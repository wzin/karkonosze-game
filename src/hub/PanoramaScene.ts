import { Container, FillGradient, Graphics, Text, Texture } from 'pixi.js';
import { FogFilter } from '../core/fx/FogFilter';
import { HeatHazeFilter } from '../core/fx/HeatHazeFilter';
import { LampLightFilter } from '../core/fx/LampLightFilter';
import { WeatherFilter, type WeatherMode } from '../core/fx/WeatherFilter';
import { DESIGN } from '../core/Layout';
import { Scene } from '../core/Scene';
import { Button } from '../ui/Button';
import { FactCard } from '../ui/FactCard';
import { HoldButton } from '../ui/HoldButton';
import { Loader } from '../ui/Loader';
import { Portrait } from '../ui/Portrait';
import { RoundProgress } from '../ui/RoundProgress';
import { SpeechBubble } from '../ui/SpeechBubble';
import { Stars } from '../ui/Stars';
import { Theme } from '../ui/Theme';
import { TopBar } from '../ui/TopBar';

interface Place {
  id: string;
  name: string;
  title: string;
  lore: string;
}

type TimedFilter = HeatHazeFilter | FogFilter | LampLightFilter | WeatherFilter;

const SWATCH = { w: 250, h: 210, gap: 20, y: 840 };

/**
 * Stub until Task 5. For now a UI-kit demo: every ui/ component and every fx/ filter on a swatch,
 * so the kit can be eyeballed (docs/screenshots/ui-kit.png). Task 5 replaces this scene entirely.
 */
export default class PanoramaScene extends Scene {
  private readonly fx: TimedFilter[] = [];
  private lamp: LampLightFilter | null = null;
  private loader: Loader | null = null;
  private hold: HoldButton | null = null;
  private readonly holdRing = new Graphics();
  private held = 0;
  private t = 0;

  async init(): Promise<void> {
    const { i18n, audio, kiosk } = this.ctx;
    const tap = () => audio.play('ui.tap');
    const places = i18n.get<Place[]>('places');
    const sniezka = places.find((p) => p.id === 'sniezka') ?? places[0];

    const sky = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: 0x1d2a4a },
        { offset: 0.6, color: 0x6b5a7a },
        { offset: 1, color: 0xdd8a2c },
      ],
    });
    this.addChild(new Graphics().rect(0, 0, DESIGN.w, DESIGN.h).fill(sky));

    const bar = new TopBar({
      title: i18n.t('app.title'),
      subtitle: i18n.t('app.subtitle'),
      backLabel: i18n.t('ui.back'),
      onBack: () => this.ctx.go('hub'),
      audio,
      muteLabel: i18n.t('ui.mute'),
      kiosk,
    });
    const progress = new RoundProgress(5, 600);
    progress.position.set((DESIGN.w - 600) / 2, TopBar.HEIGHT + 20);
    progress.set(2);
    this.addChild(bar, progress);

    // row 1: button variants, a disabled one, the hold button, stars
    const stars = new Stars(3, 56);
    stars.onStar = () => audio.play('ui.star');
    let score = 2;
    const row: Button[] = [
      new Button(i18n.t('ui.play'), {
        name: 'demo.play',
        kiosk,
        onTap: tap,
        onPress: () => {
          score = (score + 1) % 4;
          stars.set(score);
          progress.set(score + 1);
        },
      }),
      new Button(i18n.t('ui.next'), { variant: 'quiet', kiosk, onTap: tap }),
      new Button(i18n.t('ui.soon'), { variant: 'ghost', kiosk, onTap: tap }),
      new Button(i18n.t('ui.again'), { kiosk, onTap: tap }),
    ];
    row[3].enabled = false;
    this.hold = new HoldButton(i18n.t('ui.next'), { variant: 'quiet', kiosk, name: 'demo.hold', onTap: tap });
    this.hold.onHoldStart = () => (this.held = 0);
    row.push(this.hold);
    let x = 40;
    for (const b of row) {
      b.position.set(x, 176);
      x += b.box.w + 28;
      this.addChild(b);
    }
    this.holdRing.position.set(x + 30, 176 + 48);
    stars.position.set(x + 100, 184);
    stars.set(score);
    const small = new Stars(3, 34);
    small.position.set(x + 100, 256);
    small.set(3, false);
    this.addChild(this.holdRing, stars, small);

    // row 2: speech bubble and fact card
    const bubble = new SpeechBubble({ portrait: Texture.WHITE, name: sniezka.title, text: sniezka.lore, width: 1040 });
    bubble.position.set(40, 330);
    const fact = new FactCard(i18n.t('ui.didYouKnow'), places[0].lore, 790);
    fact.position.set(1100, 330);
    this.addChild(bubble, fact);

    // row 3: portrait, loader
    const portrait = new Portrait(Texture.WHITE, 120);
    portrait.position.set(110, 720);
    this.loader = new Loader(i18n.t('ui.loading'));
    this.loader.position.set(330, 680);
    this.addChild(portrait, this.loader);

    // row 4: every filter on its own swatch
    const heat = new HeatHazeFilter();
    heat.rect = [0.2, 0.25, 0.6, 0.75];
    const fog = new FogFilter();
    fog.density = 0.9;
    fog.bottom = 0.2;
    fog.drift = 0.12;
    this.lamp = new LampLightFilter();
    this.lamp.radius = 0.45;
    const swatches: [string, () => Graphics, TimedFilter][] = [
      ['HeatHazeFilter', stripes, heat],
      ['FogFilter', hills, fog],
      ['LampLightFilter', bricks, this.lamp],
      ...([1, 2, 3, 4] as WeatherMode[]).map((mode): [string, () => Graphics, TimedFilter] => {
        const w = new WeatherFilter();
        w.mode = mode;
        w.intensity = 0.9;
        return [`WeatherFilter ${mode}`, hills, w];
      }),
    ];
    swatches.forEach(([caption, draw, filter], i) => {
      const sx = 25 + i * (SWATCH.w + SWATCH.gap);
      const swatch = new Container();
      swatch.addChild(draw());
      swatch.filters = [filter];
      swatch.position.set(sx, SWATCH.y);
      const label = new Text({
        text: caption,
        style: { fontFamily: Theme.font.body, fontWeight: '800', fontSize: 20, fill: Theme.color.paper },
      });
      label.position.set(sx + 4, SWATCH.y - 30);
      this.addChild(swatch, label);
      this.fx.push(filter);
    });
  }

  update(dt: number): void {
    this.t += dt;
    for (const f of this.fx) f.time = this.t;
    if (this.lamp) this.lamp.light = [0.5 + 0.28 * Math.cos(this.t * 0.9), 0.5 + 0.22 * Math.sin(this.t * 1.3)];
    this.loader?.update(dt);
    if (this.hold?.holding) this.held = Math.min(this.held + dt / 2, 1);
    this.holdRing
      .clear()
      .circle(0, 0, 22)
      .stroke({ color: Theme.color.paper, alpha: 0.2, width: 6 })
      .arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(this.held, 0.001))
      .stroke({ color: Theme.color.glass, width: 6, cap: 'round' });
  }
}

/** Vertical bars under a dark furnace arch: shows the heat-haze ripple. */
function stripes(): Graphics {
  const g = new Graphics().rect(0, 0, SWATCH.w, SWATCH.h).fill(Theme.color.night);
  for (let x = 0; x < SWATCH.w; x += 20) g.rect(x, 0, 10, SWATCH.h).fill(Theme.color.emberSoft);
  return g.roundRect(60, 70, 130, 140, 60).fill({ color: Theme.color.ember, alpha: 0.85 });
}

/** Dusk sky with two ridges: shows fog and weather. */
function hills(): Graphics {
  const sky = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: 0x24345c },
      { offset: 1, color: 0x8a6a7a },
    ],
  });
  const { w, h } = SWATCH;
  return new Graphics()
    .rect(0, 0, w, h)
    .fill(sky)
    .poly([0, h * 0.55, w * 0.3, h * 0.3, w * 0.55, h * 0.5, w * 0.8, h * 0.25, w, h * 0.45, w, h, 0, h])
    .fill(Theme.color.dusk)
    .poly([0, h * 0.8, w * 0.4, h * 0.6, w * 0.7, h * 0.75, w, h * 0.65, w, h, 0, h])
    .fill(0x2b3346);
}

/** Bright brick wall: the lamp light reveals it. */
function bricks(): Graphics {
  const g = new Graphics().rect(0, 0, SWATCH.w, SWATCH.h).fill(0x6b4a36);
  for (let row = 0; row * 30 < SWATCH.h; row++) {
    for (let x = (row % 2) * -30; x < SWATCH.w; x += 60) {
      // clipped to the swatch: anything outside would widen the filter area
      const left = Math.max(x + 3, 0);
      const right = Math.min(x + 57, SWATCH.w);
      g.rect(left, row * 30 + 3, right - left, 24).fill(0xc9895a);
    }
  }
  return g;
}
