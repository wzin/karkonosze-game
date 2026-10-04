/** Pure helpers of the hub: marker kinds and badges, label text and the label layout. */

export interface GameRef {
  id: string;
  placeId: string;
}

export interface SaveLike {
  games: Record<string, { stars: number }>;
}

export type MarkerKind = 'hub' | 'game' | 'concept';

/** The game played at `placeId`, or null when the place only has a concept card. */
export function gameFor(games: readonly GameRef[], placeId: string): string | null {
  return games.find((g) => g.placeId === placeId)?.id ?? null;
}

/** Stars (0..3) earned in the game at `placeId`; 0 when it was never played or has no game. */
export function markerBadge(save: SaveLike, games: readonly GameRef[], placeId: string): number {
  const id = gameFor(games, placeId);
  const stars = id !== null && Object.hasOwn(save.games, id) ? save.games[id].stars : 0;
  return Number.isFinite(stars) ? Math.max(0, Math.min(3, Math.round(stars))) : 0;
}

/** The hub (where the panorama is seen from), a playable game, or a concept that is coming soon. */
export function markerKind(place: { id: string; hub?: boolean }, games: readonly GameRef[]): MarkerKind {
  if (place.hub) return 'hub';
  return gameFor(games, place.id) ? 'game' : 'concept';
}

/** Marker label lines: the name up to its first comma, then the rest ("Śnieżka, 1603 m" → Śnieżka / 1603 m). */
export function labelLines(name: string): [string, string] {
  const comma = name.indexOf(',');
  return comma < 0 ? [name.trim(), ''] : [name.slice(0, comma).trim(), name.slice(comma + 1).trim()];
}

/** The mechanic texts continue a "Mechanika:" lead-in, so they start lower-case; a card shows them alone. */
export function sentenceCase(s: string): string {
  return s.charAt(0).toLocaleUpperCase('pl') + s.slice(1);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A marker dot centred on (x, y) whose label measures w × h. */
export interface LabelItem extends Rect {
  id: string;
  /** From the label's top to the line that lines up with the dot beside it; h / 2 when omitted. */
  cy?: number;
}

export type LabelSide = 'right' | 'left' | 'below' | 'above';

/** A label's top-left corner and size, in the same space as the markers. */
export interface PlacedLabel extends Rect {
  id: string;
  side: LabelSide;
}

export interface LabelLayoutOpts {
  /** Labels must stay inside. */
  bounds: Rect;
  /** Areas labels keep clear of (title, buttons, star badges). */
  obstacles?: Rect[];
  /** From the dot centre to the near edge of its label. */
  gap?: number;
  /** Side of the square each dot occupies. */
  dot?: number;
  /** Extra room kept around other labels: markers on different layers drift apart with the parallax. */
  pad?: number;
}

const SIDES: LabelSide[] = ['right', 'left', 'below', 'above'];
/** Small shifts tried along each side, nearest first. */
const NUDGES = [0, -14, 14, -28, 28, -42, 42];

/**
 * Greedy label placement: each label in turn takes the cheapest spot around its dot, tried right,
 * left, below, above, each also nudged along that side. A spot costs its overlap with labels already
 * placed, every dot and the obstacles, plus a lot for leaving `bounds`; ties go to the earlier spot.
 */
export function layoutLabels(items: readonly LabelItem[], opts: LabelLayoutOpts): PlacedLabel[] {
  const gap = opts.gap ?? 22;
  const dotSize = opts.dot ?? 28;
  const pad = opts.pad ?? 6;
  const dots = items.map((m) => ({ x: m.x - dotSize / 2, y: m.y - dotSize / 2, w: dotSize, h: dotSize }));
  const placed: PlacedLabel[] = [];

  for (const item of items) {
    let best: PlacedLabel | null = null;
    let bestCost = Infinity;
    SIDES.forEach((side, sideIndex) => {
      NUDGES.forEach((nudge, nudgeIndex) => {
        const spot = { id: item.id, side, ...labelSpot(item, side, gap, nudge) };
        let cost = outside(spot, opts.bounds) * 1e6;
        for (const other of placed) cost += overlap(grow(spot, pad), other) * 1e3;
        for (const d of dots) cost += overlap(spot, d) * 1e3;
        for (const o of opts.obstacles ?? []) cost += overlap(spot, o) * 1e3;
        // prefer the plain sides over nudges, then the side order
        cost += nudgeIndex * 2 + sideIndex;
        if (cost < bestCost) {
          bestCost = cost;
          best = spot;
        }
      });
    });
    placed.push(best as unknown as PlacedLabel);
  }
  return placed;
}

function labelSpot(m: LabelItem, side: LabelSide, gap: number, nudge: number): Rect {
  switch (side) {
    case 'right':
      return { x: m.x + gap, y: m.y - (m.cy ?? m.h / 2) + nudge, w: m.w, h: m.h };
    case 'left':
      return { x: m.x - gap - m.w, y: m.y - (m.cy ?? m.h / 2) + nudge, w: m.w, h: m.h };
    case 'below':
      return { x: m.x - m.w / 2 + nudge * 2, y: m.y + gap, w: m.w, h: m.h };
    case 'above':
      return { x: m.x - m.w / 2 + nudge * 2, y: m.y - gap - m.h, w: m.w, h: m.h };
  }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Area of `r` that lies outside `bounds`. */
function outside(r: Rect, bounds: Rect): number {
  return r.w * r.h - overlap(r, bounds);
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}
