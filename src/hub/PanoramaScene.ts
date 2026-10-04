import { Container, Graphics, Rectangle, Sprite, Text, type DestroyOptions, type FederatedPointerEvent } from 'pixi.js';
import { sprite } from '../core/Assets';
import { FogFilter } from '../core/fx/FogFilter';
import { DESIGN } from '../core/Layout';
import { mulberry32 } from '../core/Rng';
import { Scene } from '../core/Scene';
import { GAMES } from '../games';
import { Button } from '../ui/Button';
import { Theme } from '../ui/Theme';
import { ConceptCard } from './ConceptCard';
import { Markers, type Place } from './Markers';
import { DEPTH, Parallax, type Depth } from './Parallax';
import { gameFor, type MarkerKind, type Rect } from './rules';

/**
 * The composition, read off the generated layers: the sky is lifted so its dusk glow shows above the
 * main ridge (its own painted hills stay hidden behind `ridge_far`); each cut-out layer is centred,
 * scaled a little past the screen width so the parallax never uncovers an edge, and placed by its top.
 */
const SKY_LIFT = 140;
const LAYERS: Record<Depth, { alias: string; y: number; scale: number }> = {
  far: { alias: 'hub/ridge_far', y: 330, scale: 1.01 },
  mid: { alias: 'hub/ridge_mid', y: 440, scale: 1.02 },
  valley: { alias: 'hub/valley', y: 700, scale: 1.08 },
};
/** Duch Gór stands behind Śnieżka (cone summit ≈ x 490): only his upper half shows above the ridge. */
const GHOST = { x: 500, y: 640, height: 470, alpha: 0.25, breath: 0.02, period: 7 };
const CLOUDS = [
  { alias: 'hub/cloud_1', x: 1180, y: 230, scale: 0.46, speed: 14, alpha: 0.32, tint: 0xc4bddc },
  { alias: 'hub/cloud_2', x: 220, y: 380, scale: 0.5, speed: 19, alpha: 0.5, tint: 0xe8dcec },
];
const STAR_COUNT = 60;
const STAR_FIELD = { top: 10, bottom: 420 };
/** Dusk fog over the valley floor, tinted to the sky. */
const FOG = { density: 0.35, bottom: 0.55, color: [0.8, 0.78, 0.88] as [number, number, number] };
const MARGIN = 32;
const SOUND_BUTTON_H = 72;

interface Twinkle {
  view: Graphics;
  base: number;
  speed: number;
  phase: number;
}

interface Cloud {
  view: Sprite;
  speed: number;
}

/** The first pointerdown anywhere unlocks audio for the whole visit (browser autoplay policy). */
let gestureSeen = false;

/**
 * The hub: a dusk panorama of the Karkonosze seen from Grodna. Parallax layers follow the pointer,
 * clouds drift, stars twinkle, Duch Gór breathes over Śnieżka and fog lies in the valley. Markers
 * open a game, or a concept card for places whose game is not made yet.
 */
export default class PanoramaScene extends Scene {
  private readonly parallax = new Parallax();
  private readonly fog = new FogFilter();
  private readonly twinkles: Twinkle[] = [];
  private readonly clouds: Cloud[] = [];
  private ghost: Sprite | null = null;
  private ghostScale = 1;
  private markers: Markers | null = null;
  private card: ConceptCard | null = null;
  private audioOn = false;
  private t = 0;

  async init(): Promise<void> {
    await this.ctx.assets.loadGroup('hub');
    const { i18n } = this.ctx;

    // everything is laid out in design space; the frame keeps overscan out of the letterbox bars
    const frame = new Graphics().rect(0, 0, DESIGN.w, DESIGN.h).fill(0xffffff);
    this.addChild(frame);
    this.mask = frame;
    this.eventMode = 'static';
    this.hitArea = new Rectangle(0, 0, DESIGN.w, DESIGN.h);

    const sky = sprite(this.ctx.assets, 'hub/sky', { w: DESIGN.w, h: DESIGN.h, tint: 0x3a4a7a });
    sky.y = -SKY_LIFT;
    this.addChild(sky, this.buildStars(), this.buildGhost(), this.buildClouds());
    this.addChild(this.buildLayer('far'), this.buildLayer('mid'));

    // the fog sits still over the moving valley: its area is the screen, not the layer's bounds
    const valley = new Container();
    valley.addChild(this.buildLayer('valley'));
    this.fog.density = FOG.density;
    this.fog.bottom = FOG.bottom;
    this.fog.color = FOG.color;
    valley.filters = [this.fog];
    valley.filterArea = new Rectangle(0, 0, DESIGN.w, DESIGN.h);
    this.addChild(valley);

    const heading = this.buildHeading(i18n.t('app.title'), i18n.t('app.viewpoint'));
    const sound = this.buildSoundButton();
    this.markers = new Markers({
      places: i18n.get<Place[]>('places'),
      games: GAMES,
      save: this.ctx.save.load(),
      obstacles: [grow(rectOf(heading), 12), grow(rectOf(sound), 12)],
      onTap: () => this.ctx.audio.play('ui.tap'),
      onPick: (place, kind) => this.pick(place, kind),
    });
    this.addChild(this.markers, heading, sound);

    this.on('pointerdown', (e: FederatedPointerEvent) => {
      gestureSeen = true;
      this.startAudio();
      this.pointAt(e);
    });
    this.on('globalpointermove', (e: FederatedPointerEvent) => this.pointAt(e));
  }

  enter(): void {
    // back from a game the page has had its gesture already
    if (gestureSeen) this.startAudio();
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    this.parallax.update(dt);
    this.markers?.update(dt, this.parallax);
    this.fog.time = t;

    for (const s of this.twinkles) s.view.alpha = s.base * (0.6 + 0.4 * Math.sin(t * s.speed + s.phase));
    for (const c of this.clouds) {
      c.view.x += c.speed * dt;
      if (c.view.x - c.view.width / 2 > DESIGN.w) c.view.x = -c.view.width / 2;
    }
    if (this.ghost) {
      this.ghost.scale.set(this.ghostScale * (1 + GHOST.breath * Math.sin((t * Math.PI * 2) / GHOST.period)));
    }

    if (this.card) {
      this.card.update(dt);
      if (this.card.closed) {
        this.card.destroy({ children: true });
        this.card = null;
      }
    }
  }

  exit(): void {
    this.ctx.audio.stop('hub.music');
    this.ctx.audio.stop('hub.wind');
  }

  override destroy(options?: DestroyOptions): void {
    super.destroy(options);
    this.fog.destroy();
  }

  private pick(place: Place, kind: MarkerKind): void {
    const gameId = kind === 'game' ? gameFor(GAMES, place.id) : null;
    if (gameId) {
      this.ctx.go(`game:${gameId}`);
      return;
    }
    if (this.card && !this.card.closing) return;
    // a card still fading out gives way to the new one
    this.card?.destroy({ children: true });
    this.card = new ConceptCard(place, {
      soon: this.ctx.i18n.t('ui.soon'),
      kiosk: this.ctx.kiosk,
      onTap: () => this.ctx.audio.play('ui.tap'),
      onClose: () => this.card?.close(),
    });
    this.addChild(this.card);
  }

  private startAudio(): void {
    if (this.audioOn) return;
    this.audioOn = true;
    this.ctx.audio.play('hub.music', { loop: true, volume: 0.5 });
    this.ctx.audio.play('hub.wind', { loop: true, volume: 0.25 });
  }

  private pointAt(e: FederatedPointerEvent): void {
    const p = this.toLocal(e.global);
    this.parallax.pointAt(p.x, p.y);
  }

  private buildLayer(depth: Depth): Container {
    const { alias, y, scale } = LAYERS[depth];
    const s = sprite(this.ctx.assets, alias);
    s.anchor.set(0.5, 0);
    s.scale.set(s.scale.x * scale, s.scale.y * scale);
    s.position.set(DESIGN.w / 2, y);
    const view = new Container();
    view.addChild(s);
    this.parallax.add(view, DEPTH[depth]);
    return view;
  }

  private buildStars(): Container {
    const field = new Container();
    const rng = mulberry32(1806);
    for (let i = 0; i < STAR_COUNT; i++) {
      const y = STAR_FIELD.top + rng() * (STAR_FIELD.bottom - STAR_FIELD.top);
      // stars fade out towards the glow above the ridge
      const depthFade = 1 - Math.max(0, (y - 260) / (STAR_FIELD.bottom - 260)) * 0.7;
      const view = new Graphics().circle(0, 0, 0.9 + rng() * 1.7).fill(0xfff6d8);
      view.position.set(rng() * DESIGN.w, y);
      const twinkle = { view, base: (0.35 + rng() * 0.65) * depthFade, speed: 0.6 + rng() * 1.8, phase: rng() * Math.PI * 2 };
      view.alpha = twinkle.base;
      this.twinkles.push(twinkle);
      field.addChild(view);
    }
    return field;
  }

  private buildGhost(): Container {
    const view = new Container();
    if (!this.ctx.assets.has('hub/duch_gor')) return view;
    const ghost = sprite(this.ctx.assets, 'hub/duch_gor');
    ghost.anchor.set(0.5, 1);
    this.ghostScale = GHOST.height / ghost.texture.height;
    ghost.scale.set(this.ghostScale);
    ghost.position.set(GHOST.x, GHOST.y);
    ghost.alpha = GHOST.alpha;
    view.addChild(ghost);
    this.ghost = ghost;
    this.parallax.add(view, DEPTH.far);
    return view;
  }

  private buildClouds(): Container {
    const sky = new Container();
    for (const c of CLOUDS) {
      if (!this.ctx.assets.has(c.alias)) continue;
      const view = sprite(this.ctx.assets, c.alias);
      view.anchor.set(0.5);
      view.scale.set(c.scale);
      view.position.set(c.x, c.y);
      view.alpha = c.alpha;
      view.tint = c.tint;
      this.clouds.push({ view, speed: c.speed });
      sky.addChild(view);
    }
    return sky;
  }

  private buildHeading(title: string, viewpoint: string): Container {
    const shadow = { color: Theme.color.night, alpha: 0.65, blur: 10, distance: 3, angle: Math.PI / 2 };
    const heading = new Container();
    const titleText = new Text({
      text: title,
      style: { fontFamily: Theme.font.display, fontWeight: '900', fontSize: 84, fill: Theme.color.paper, dropShadow: shadow },
    });
    const sub = new Text({
      text: viewpoint,
      style: { fontFamily: Theme.font.body, fontWeight: '700', fontSize: 26, fill: Theme.color.emberSoft, dropShadow: shadow },
    });
    sub.position.set(4, titleText.height - 6);
    heading.addChild(titleText, sub);
    heading.position.set(MARGIN + 18, MARGIN - 4);
    return heading;
  }

  /** Icon only: a label would run into the moon painted in the sky. */
  private buildSoundButton(): Button {
    const { audio, kiosk } = this.ctx;
    const speaker = new Graphics();
    drawSpeaker(speaker, audio.muted);
    const button = new Button('', {
      variant: 'quiet',
      height: SOUND_BUTTON_H,
      icon: speaker,
      kiosk,
      name: 'hub.mute',
      onTap: () => audio.play('ui.tap'),
      onPress: () => {
        audio.setMuted(!audio.muted);
        drawSpeaker(speaker, audio.muted);
      },
    });
    button.position.set(DESIGN.w - MARGIN - button.box.w, MARGIN);
    return button;
  }
}

function rectOf(view: Container): Rect {
  const b = view.getLocalBounds();
  return { x: view.x + b.x, y: view.y + b.y, w: b.width, h: b.height };
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

/** Speaker with sound waves, or crossed out when muted; drawn around (0, 0) like the TopBar's. */
function drawSpeaker(g: Graphics, muted: boolean): void {
  const s = 30;
  g.clear();
  const body = [-0.5, -0.2, -0.22, -0.2, 0.08, -0.48, 0.08, 0.48, -0.22, 0.2, -0.5, 0.2];
  g.poly(body.map((v) => v * s)).fill(Theme.color.paper);
  if (muted) {
    g.moveTo(s * 0.26, -s * 0.2)
      .lineTo(s * 0.62, s * 0.2)
      .moveTo(s * 0.62, -s * 0.2)
      .lineTo(s * 0.26, s * 0.2)
      .stroke({ color: Theme.color.bad, width: 5, cap: 'round' });
    return;
  }
  for (const r of [s * 0.3, s * 0.55]) {
    g.moveTo(s * 0.08 + r * Math.cos(-0.75), r * Math.sin(-0.75))
      .arc(s * 0.08, 0, r, -0.75, 0.75)
      .stroke({ color: Theme.color.paper, width: 4, cap: 'round' });
  }
}
