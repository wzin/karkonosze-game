import { Container, Graphics, Rectangle, Text, type DestroyOptions } from 'pixi.js';
import { DESIGN, type ViewLayout } from '../core/Layout';
import { Stars } from '../ui/Stars';
import { Theme, effectiveHitMin } from '../ui/Theme';
import { DEPTH, type Depth, type Parallax } from './Parallax';
import {
  labelLines,
  layoutLabels,
  markerBadge,
  markerKind,
  type GameRef,
  type LabelSide,
  type MarkerKind,
  type Rect,
  type SaveLike,
} from './rules';

/** One entry of `places` in content/pl.json. */
export interface Place {
  id: string;
  name: string;
  title: string;
  region: string;
  lore: string;
  mech: string;
  x: number;
  y: number;
  hub?: boolean;
}

/**
 * The layer under each marker's x, y in content/pl.json, so the marker moves with its own ground:
 * the main ridge (Śnieżka, its slopes and the Kowary side, the Jakuszyce shoulder), the foothills
 * (Grodna, Chojnik, the ridge foot at Szklarska, the forests at both ends) or the valley floor.
 * Recheck it when the coordinates move. Places not listed stand on the foothills.
 */
const GROUND: Record<string, Depth> = {
  sniezka: 'far',
  lomniczka: 'far',
  wang: 'far',
  karpacz: 'far',
  kowary: 'far',
  jakuszyce: 'far',
  walonowie: 'mid',
  staniszow: 'mid',
  chojnik: 'mid',
  szklarska: 'mid',
  jeziorka: 'mid',
  kamienna: 'valley',
  myslakowice: 'valley',
  palace: 'valley',
  jelenia: 'valley',
  cieplice: 'valley',
  siedlecin: 'valley',
};

/** Dot radius: the marker circle is 22 px across. */
const DOT_R = 11;
/** Side of the square hit area round the dot, design px; more on a small screen (effectiveHitMin). */
const HIT = 96;
const BADGE_SIZE = 28;
/** Stars(3, 28) is 2 × 1.2 × 28 + 28 wide. */
const BADGE_W = BADGE_SIZE * 3.4;
const BADGE_GAP = 8;
const PING_PERIOD = 2.2;
/** The ring grows to this many times its size before it fades out. */
const PING_GROWTH = 1.4;
const MARGIN = 16;

const DOT_FILL: Record<MarkerKind, number> = {
  hub: Theme.color.ember,
  game: Theme.color.glass,
  concept: Theme.color.paper,
};

export interface MarkersOpts {
  places: readonly Place[];
  games: readonly GameRef[];
  save: SaveLike;
  /** Areas the labels keep clear of (title, sound button). */
  obstacles: Rect[];
  /** `ctx.layout`: the dot hit areas never map to under 44 CSS px. */
  layout: ViewLayout;
  onPick: (place: Place, kind: MarkerKind) => void;
  /** Every pointerdown on a marker; the scene plays `ui.tap` here. */
  onTap?: () => void;
}

/** The 17 places on the panorama: dot, label, star badge; each rides the parallax of its own ground. */
export class Markers extends Container {
  private readonly list: Marker[] = [];
  private t = 0;

  constructor(opts: MarkersOpts) {
    super();
    for (const place of opts.places) {
      const kind = markerKind(place, opts.games);
      const marker = new Marker(place, kind, markerBadge(opts.save, opts.games, place.id), opts.layout, (m, x, y) =>
        this.ownsDot(m, x, y),
      );
      marker.on('pointerdown', () => opts.onTap?.());
      marker.on('pointertap', () => opts.onPick(place, kind));
      this.list.push(marker);
      this.addChild(marker);
    }
    this.layout(opts.obstacles);
  }

  /** Advances the pings and hover easing and follows the parallax. */
  update(dt: number, parallax: Parallax): void {
    this.t += dt;
    for (const m of this.list) {
      const s = parallax.shift(m.factor);
      m.position.set(m.place.x + s.x, m.place.y + s.y);
      m.update(dt, this.t);
    }
  }

  /** Sets every label beside its dot so no two labels, dots or badges overlap. */
  private layout(obstacles: Rect[]): void {
    const badges = this.list
      .filter((m) => m.badge)
      .map((m) => ({ x: m.place.x - BADGE_W / 2, y: m.place.y - DOT_R - BADGE_GAP - BADGE_SIZE, w: BADGE_W, h: BADGE_SIZE }));
    // the hub and the playable games choose their spot first
    const order = [...this.list].sort((a, b) => rank(a.kind) - rank(b.kind));
    const placed = layoutLabels(
      order.map((m) => ({ id: m.place.id, x: m.place.x, y: m.place.y, w: m.caption.w, h: m.caption.h, cy: m.caption.cy })),
      {
        bounds: { x: MARGIN, y: MARGIN, w: DESIGN.w - MARGIN * 2, h: DESIGN.h - MARGIN * 2 },
        obstacles: [...obstacles, ...badges],
        gap: DOT_R + 12,
      },
    );
    for (const spot of placed) {
      const m = this.list.find((x) => x.place.id === spot.id);
      m?.setLabel(spot.x - m.place.x, spot.y - m.place.y, spot.side);
    }
  }

  override destroy(options?: DestroyOptions): void {
    for (const m of this.list) m.unregister();
    super.destroy(options);
  }

  /**
   * Whether `m` has the nearest dot to (x, y) (this container's space) among the markers whose dot
   * square holds the point: where the squares of close markers overlap, the nearer dot takes the tap.
   */
  private ownsDot(m: Marker, x: number, y: number): boolean {
    const d = Math.hypot(x - m.x, y - m.y);
    return this.list.every((o) => o === m || !o.dotHit(x - o.x, y - o.y) || Math.hypot(x - o.x, y - o.y) >= d);
  }
}

function rank(kind: MarkerKind): number {
  return kind === 'hub' ? 0 : kind === 'game' ? 1 : 2;
}

class Marker extends Container {
  readonly factor: number;
  readonly caption: Caption;
  readonly badge: Stars | null = null;
  private readonly pin = new Container();
  private readonly ping = new Graphics();
  private readonly phase: number;
  private hovered = false;
  private hover = 0;
  readonly unregister: () => void;

  constructor(
    readonly place: Place,
    readonly kind: MarkerKind,
    stars: number,
    private readonly layout: ViewLayout,
    /** Markers.ownsDot, in the parent's space. */
    private readonly ownsDot: (m: Marker, x: number, y: number) => boolean,
  ) {
    super();
    this.factor = DEPTH[GROUND[place.id] ?? 'mid'];
    this.position.set(place.x, place.y);
    this.phase = (place.x / DESIGN.w) * PING_PERIOD;

    const fill = DOT_FILL[kind];
    const edge = kind === 'concept' ? Theme.color.ink : Theme.color.paper;
    const dot = new Graphics()
      .circle(0, 2, DOT_R + 3)
      .fill({ color: Theme.color.night, alpha: 0.45 })
      .circle(0, 0, DOT_R + 7)
      .stroke({ color: kind === 'concept' ? Theme.color.paper : fill, alpha: 0.55, width: 2 })
      .circle(0, 0, DOT_R)
      .fill(fill)
      .stroke({ color: edge, width: 3 });
    // playable games and the hub send out a slow ring, so they read as "tap me"
    this.ping.circle(0, 0, DOT_R + 4).stroke({ color: fill, width: 3 });
    this.ping.visible = kind !== 'concept';
    this.pin.addChild(this.ping, dot);

    this.caption = new Caption(place.name, kind === 'hub' ? Theme.color.emberSoft : Theme.color.paper);
    this.addChild(this.pin, this.caption);

    if (stars > 0) {
      this.badge = new Stars(3, BADGE_SIZE);
      this.badge.set(stars, false);
      this.badge.position.set(-BADGE_W / 2, -DOT_R - BADGE_GAP - BADGE_SIZE);
      this.addChild(this.badge);
    }

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.interactiveChildren = false;
    this.on('pointerover', () => (this.hovered = true));
    this.on('pointerout', () => (this.hovered = false));
    this.setLabel(DOT_R + 12, -this.caption.cy, 'right');
    this.unregister = registerDevTarget(`hub.${place.id}`, () => {
      const half = this.dotSide() / 2;
      const c = this.toGlobal({ x: 0, y: 0 });
      const a = this.toGlobal({ x: -half, y: -half });
      const z = this.toGlobal({ x: half, y: half });
      return { x: c.x, y: c.y, width: Math.abs(z.x - a.x), height: Math.abs(z.y - a.y) };
    });
  }

  /** Side of the square dot hit area now: HIT, or more on a small screen. */
  dotSide(): number {
    return Math.max(HIT, effectiveHitMin(false, this.layout.scale));
  }

  /** Whether (px, py), in this marker's space, is inside its dot square. */
  dotHit(px: number, py: number): boolean {
    const half = this.dotSide() / 2;
    return px >= -half && px < half && py >= -half && py < half;
  }

  /** Puts the label's top-left corner at (x, y) from the dot; the hit area covers dot and label. */
  setLabel(x: number, y: number, side: LabelSide): void {
    this.caption.position.set(Math.round(x), Math.round(y));
    this.caption.align(side);
    const pad = 8;
    const box = new Rectangle(this.caption.x - pad, this.caption.y - pad, this.caption.w + pad * 2, this.caption.h + pad * 2);
    // the dot square is sized on every test (it grows on a phone) and yields to a nearer dot
    this.hitArea = {
      contains: (px: number, py: number) =>
        box.contains(px, py) || (this.dotHit(px, py) && this.ownsDot(this, this.x + px, this.y + py)),
    };
  }

  update(dt: number, t: number): void {
    this.hover += ((this.hovered ? 1 : 0) - this.hover) * Math.min(1, dt * 12);
    this.pin.scale.set(1 + this.hover * 0.3);
    if (!this.ping.visible) return;
    const p = ((t + this.phase) % PING_PERIOD) / PING_PERIOD;
    this.ping.scale.set(1 + p * PING_GROWTH);
    this.ping.alpha = (1 - p) * 0.8;
  }
}

/** Marker label: the place name in bold, what follows its first comma on a smaller second line. */
class Caption extends Container {
  readonly w: number;
  readonly h: number;
  /** Middle of the first line, which lines up with the dot when the label sits beside it. */
  readonly cy: number;
  private readonly lines: Text[];

  constructor(name: string, fill: number) {
    super();
    const [main, rest] = labelLines(name);
    const first = new Text({ text: main, style: captionStyle(26, '800', fill) });
    this.lines = [first];
    if (rest) {
      const second = new Text({ text: rest, style: captionStyle(20, '700', fill) });
      second.alpha = 0.88;
      second.y = first.height - 9;
      this.lines.push(second);
    }
    this.addChild(...this.lines);
    this.w = Math.max(...this.lines.map((l) => l.width));
    const last = this.lines[this.lines.length - 1];
    this.h = last.y + last.height;
    this.cy = first.height / 2;
  }

  /** The lines hug the dot: right-aligned left of it, centred above or below it. */
  align(side: LabelSide): void {
    for (const line of this.lines) {
      line.x = side === 'right' ? 0 : side === 'left' ? this.w - line.width : (this.w - line.width) / 2;
    }
  }
}

/** Soft labels for the dusk: the fill a touch see-through, a thinner dark edge, a low shadow. */
function captionStyle(fontSize: number, fontWeight: '700' | '800', fill: number) {
  return {
    fontFamily: Theme.font.body,
    fontWeight,
    fontSize,
    fill: { color: fill, alpha: 0.9 },
    stroke: { color: Theme.color.night, width: 4.5, alpha: 0.85, join: 'round' as const },
    dropShadow: { color: Theme.color.night, alpha: 0.45, blur: 5, distance: 2, angle: Math.PI / 2 },
  };
}

/**
 * Dev only: smoke tests find a marker's centre and dot hit-box size (CSS px) as
 * `window.__bk.buttons['hub.<placeId>']`.
 */
function registerDevTarget(
  name: string,
  target: () => { x: number; y: number; width: number; height: number },
): () => void {
  if (!import.meta.env.DEV) return () => {};
  const bk = (window.__bk ??= { sceneId: null });
  const buttons = (bk.buttons ??= {});
  const locate = () => {
    const t = target();
    return { x: t.x, y: t.y, width: t.width, height: t.height };
  };
  buttons[name] = locate;
  return () => {
    if (buttons[name] === locate) delete buttons[name];
  };
}
