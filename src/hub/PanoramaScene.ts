import { Container, Graphics, Rectangle, Sprite, Text, Texture, type DestroyOptions, type FederatedPointerEvent } from 'pixi.js';
import { sprite } from '../core/Assets';
import { FogFilter } from '../core/fx/FogFilter';
import { MistBand, bob } from '../core/fx/Mist';
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
 * Where the layers sit, in design px: the one table to retune when the art changes (the coming main
 * ridge is taller and more massive: raise `far`, then the ghost's feet and the upper mist with it).
 * The sky is lifted so its dusk glow shows above the main ridge (its own painted hills stay hidden
 * behind `ridge_far`); each cut-out layer is centred, scaled a little past the screen width so the
 * parallax never uncovers an edge, and placed by its top edge; mist bands are placed by their centre
 * line, Duch Gór by his feet (hidden behind Śnieżka's cone, x ≈ 490).
 */
const PLACE = {
  skyLift: 140,
  far: { y: 330, scale: 1.01 },
  mid: { y: 440, scale: 1.02 },
  valley: { y: 700, scale: 1.08 },
  ghost: { x: 500, y: 640 },
  /** Mist centre lines: at the foot of the main ridge, along the foothills, over the valley floor. */
  mist: [585, 770, 985],
} as const;

const LAYERS: Record<Depth, string> = { far: 'hub/ridge_far', mid: 'hub/ridge_mid', valley: 'hub/valley' };
/** Only his upper half shows above the ridge, faint and slowly breathing. */
const GHOST = { height: 470, alpha: 0.2, breath: 0.02, period: 7 };
const CLOUDS = [
  { alias: 'hub/cloud_1', x: 1180, y: 230, scale: 0.46, speed: 11, alpha: 0.28, tint: 0xa9a3c6 },
  { alias: 'hub/cloud_2', x: 220, y: 380, scale: 0.5, speed: 15, alpha: 0.4, tint: 0xc2b6cf },
];
interface MistSpec {
  alias: string;
  /** The layer drawn just behind the band. */
  after: Depth;
  /** Parallax factor, between those of the planes behind and in front. */
  factor: number;
  height: number;
  /** Drift to the right, px/s. */
  speed: number;
  alpha: number;
  /** Up-and-down swing, px, and its period, s. */
  bob: number;
  period: number;
}
/**
 * Dusk mist, in PLACE.mist order: each band drifts right on the wind, swings gently up and down and
 * rides the parallax between its two planes. Tinted to the dusk sky like the fog; the stand-in
 * streak (until the art lands) reads as mist at these alphas too.
 */
const MISTS: MistSpec[] = [
  { alias: 'hub/mist_1', after: 'far', factor: 0.22, height: 300, speed: 7, alpha: 0.35, bob: 6, period: 23 },
  { alias: 'hub/mist_2', after: 'mid', factor: 0.4, height: 260, speed: 10, alpha: 0.3, bob: 5, period: 19 },
  { alias: 'hub/mist_1', after: 'valley', factor: 0.6, height: 240, speed: 14, alpha: 0.22, bob: 4, period: 29 },
];
const MIST_TINT = 0xd6d2ec;
/** Each mist copy overhangs both screen edges by this much, more than any parallax shift. */
const MIST_OVERHANG = 64;
const STAR_COUNT = 40;
const STAR_FIELD = { top: 10, bottom: 420 };
type FogSpec = { density: number; bottom: number };
/**
 * Dusk fog tinted to the sky, on the foothills and over the valley floor. Both filter the whole
 * screen (so `bottom` is a screen uv: the fog starts there and thickens to the lower edge).
 */
const FOG: Partial<Record<Depth, FogSpec>> = {
  mid: { density: 0.55, bottom: 0.42 },
  valley: { density: 0.35, bottom: 0.55 },
};
const FOG_COLOR: [number, number, number] = [0.8, 0.78, 0.88];
/** Dark edges over the landscape, under the markers and title: `alpha` at the corners. */
const VIGNETTE_ALPHA = 0.35;
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

interface Mist {
  band: MistBand;
  speed: number;
  bob: number;
  period: number;
  phase: number;
}

/** The first pointerdown anywhere unlocks audio for the whole visit (browser autoplay policy). */
let gestureSeen = false;

/**
 * The hub: a dusk panorama of the Karkonosze seen from Grodna. Parallax layers follow the pointer,
 * mist drifts between them, fog lies on the foothills and the valley floor, clouds pass, a few stars
 * twinkle and Duch Gór breathes over Śnieżka; the edges sink into a vignette. Markers open a game,
 * or a concept card for places whose game is not made yet.
 */
export default class PanoramaScene extends Scene {
  private readonly parallax = new Parallax();
  private readonly fogs: FogFilter[] = [];
  private readonly twinkles: Twinkle[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly mists: Mist[] = [];
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
    sky.y = -PLACE.skyLift;
    this.addChild(sky, this.buildStars(), this.buildGhost(), this.buildClouds());
    for (const depth of ['far', 'mid', 'valley'] as const) {
      this.addChild(this.buildLayer(depth));
      MISTS.forEach((m, i) => {
        if (m.after === depth) this.addChild(this.buildMist(m, PLACE.mist[i]));
      });
    }
    this.addChild(vignette());

    const heading = this.buildHeading(i18n.t('app.title'), i18n.t('app.viewpoint'));
    const sound = this.buildSoundButton();
    this.markers = new Markers({
      places: i18n.get<Place[]>('places'),
      games: GAMES,
      save: this.ctx.save.load(),
      obstacles: [grow(rectOf(heading), 12), grow(rectOf(sound), 12)],
      layout: this.ctx.layout,
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
    for (const fog of this.fogs) fog.time = t;

    for (const s of this.twinkles) s.view.alpha = s.base * (0.6 + 0.4 * Math.sin(t * s.speed + s.phase));
    for (const c of this.clouds) {
      c.view.x += c.speed * dt;
      if (c.view.x - c.view.width / 2 > DESIGN.w) c.view.x = -c.view.width / 2;
    }
    for (const m of this.mists) {
      m.band.scroll(-m.speed * dt);
      m.band.y = bob(t, m.bob, m.period, m.phase);
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
    for (const fog of this.fogs) fog.destroy();
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
      layout: this.ctx.layout,
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

  /** A landscape layer on the parallax; with fog, the fog stays still over it (its area is the screen). */
  private buildLayer(depth: Depth): Container {
    const { y, scale } = PLACE[depth];
    const s = sprite(this.ctx.assets, LAYERS[depth]);
    s.anchor.set(0.5, 0);
    s.scale.set(s.scale.x * scale, s.scale.y * scale);
    s.position.set(DESIGN.w / 2, y);
    const view = new Container();
    view.addChild(s);
    this.parallax.add(view, DEPTH[depth]);
    const spec = FOG[depth];
    if (!spec) return view;
    const fog = new FogFilter();
    fog.density = spec.density;
    fog.bottom = spec.bottom;
    fog.color = FOG_COLOR;
    this.fogs.push(fog);
    const still = new Container();
    still.addChild(view);
    still.filters = [fog];
    still.filterArea = new Rectangle(0, 0, DESIGN.w, DESIGN.h);
    return still;
  }

  /** One mist band centred on `y`, riding the parallax between its two planes. */
  private buildMist(spec: MistSpec, y: number): Container {
    const band = new MistBand(this.ctx.assets, {
      alias: spec.alias,
      height: spec.height,
      minWidth: DESIGN.w + MIST_OVERHANG * 2,
      alpha: spec.alpha,
      tint: MIST_TINT,
    });
    // the band bobs inside a holder that the parallax moves
    const holder = new Container();
    holder.position.set(-MIST_OVERHANG, y);
    holder.addChild(band);
    this.parallax.add(holder, spec.factor);
    this.mists.push({ band, speed: spec.speed, bob: spec.bob, period: spec.period, phase: this.mists.length * 2.1 });
    // each band starts at its own point of the drift
    band.scroll(-(this.mists.length * 517));
    return holder;
  }

  private buildStars(): Container {
    const field = new Container();
    const rng = mulberry32(1806);
    for (let i = 0; i < STAR_COUNT; i++) {
      const y = STAR_FIELD.top + rng() * (STAR_FIELD.bottom - STAR_FIELD.top);
      // stars fade out towards the glow above the ridge
      const depthFade = 1 - Math.max(0, (y - 260) / (STAR_FIELD.bottom - 260)) * 0.75;
      const view = new Graphics().circle(0, 0, 0.6 + rng() * 1.1).fill(0xfff6d8);
      view.position.set(rng() * DESIGN.w, y);
      const twinkle = { view, base: (0.3 + rng() * 0.5) * depthFade, speed: 0.25 + rng() * 0.7, phase: rng() * Math.PI * 2 };
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
    ghost.position.set(PLACE.ghost.x, PLACE.ghost.y);
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
    const { audio, kiosk, layout } = this.ctx;
    const speaker = new Graphics();
    drawSpeaker(speaker, audio.muted);
    const button = new Button('', {
      variant: 'quiet',
      height: SOUND_BUTTON_H,
      icon: speaker,
      kiosk,
      layout,
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

let vignetteTexture: Texture | null = null;

/**
 * Night-coloured edges: a radial gradient drawn once to a small square canvas and stretched over the
 * screen, so it is an ellipse; clear over the middle, VIGNETTE_ALPHA in the corners.
 */
function vignette(): Sprite {
  if (!vignetteTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d');
    if (g) {
      const c = Theme.color.night;
      const rgba = (a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
      const shade = g.createRadialGradient(128, 128, 0, 128, 128, 128 * Math.SQRT2);
      shade.addColorStop(0, rgba(0));
      shade.addColorStop(0.45, rgba(0));
      shade.addColorStop(0.75, rgba(0.4));
      shade.addColorStop(1, rgba(1));
      g.fillStyle = shade;
      g.fillRect(0, 0, 256, 256);
    }
    vignetteTexture = g ? Texture.from(canvas) : Texture.EMPTY;
  }
  const view = new Sprite(vignetteTexture);
  view.width = DESIGN.w;
  view.height = DESIGN.h;
  view.alpha = VIGNETTE_ALPHA;
  view.eventMode = 'none';
  return view;
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
