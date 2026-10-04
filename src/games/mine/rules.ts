import { shuffle } from '../../core/Rng';

export type OreType = 'iron' | 'uranium';
export type MineBg = 'mine/bg_1' | 'mine/bg_2' | 'mine/bg_3';

/** An ore vein at (x, y) in design px; it is mined out when `hitsLeft` reaches 0. */
export interface Vein {
  id: number;
  x: number;
  y: number;
  type: OreType;
  hitsLeft: number;
}

export interface Level {
  index: 1 | 2 | 3;
  bg: MineBg;
  oilSeconds: number;
  veins: Vein[];
  /** Water dripping from the roof at `x`, one drop every `periodS` seconds. */
  drips: { x: number; periodS: number }[];
  bats: number;
  /** Lamp light radius in heights of the screen (LampLightFilter uv). */
  lampRadius: number;
}

/** Rectangle of vein centres, design px. */
export interface Zone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const HITS = 3;
/** Smallest distance between two veins, px. */
export const VEIN_GAP = 220;
/** Every vein centre lies in here. */
export const VEIN_AREA: Zone = { x0: 200, y0: 300, x1: 1720, y1: 980 };
const MAX_TRIES = 500;

/**
 * Where the rock walls of each background are (vein centres, design px), so veins sit in rock and
 * not on the floor, in the dark open gallery or on the timbering. Measured on the 1920×1080 art.
 */
export const ROCK_ZONES: Record<MineBg, Zone[]> = {
  'mine/bg_1': [
    { x0: 200, y0: 420, x1: 240, y1: 540 }, // rock wall behind the left props
    { x0: 1680, y0: 330, x1: 1720, y1: 560 }, // rock wall behind the right props
    { x0: 220, y0: 840, x1: 1640, y1: 960 }, // rock under the floor
  ],
  'mine/bg_2': [
    { x0: 210, y0: 330, x1: 400, y1: 780 }, // rock face left of the chamber
    { x0: 240, y0: 870, x1: 1640, y1: 970 }, // rock under the floor
  ],
  'mine/bg_3': [
    { x0: 340, y0: 430, x1: 1640, y1: 640 }, // rock behind the tunnel lining
    { x0: 240, y0: 870, x1: 1640, y1: 960 }, // rock under the tunnel
  ],
};

const SPECS: Record<Level['index'], Omit<Level, 'index' | 'veins' | 'drips'> & { iron: number; uranium: number; drips: number }> = {
  1: { bg: 'mine/bg_1', iron: 5, uranium: 0, oilSeconds: 60, lampRadius: 0.22, drips: 2, bats: 0 },
  2: { bg: 'mine/bg_2', iron: 4, uranium: 2, oilSeconds: 55, lampRadius: 0.2, drips: 3, bats: 1 },
  3: { bg: 'mine/bg_3', iron: 2, uranium: 5, oilSeconds: 50, lampRadius: 0.18, drips: 4, bats: 2 },
};

/** Drips fall every 5–9 s. */
const DRIP_PERIOD = { min: 5, max: 9 };
/** Drips stay this far from the screen edges. */
const DRIP_MARGIN = 240;

export function levelConfig(index: 1 | 2 | 3, rng: () => number): Level {
  const spec = SPECS[index];
  const types = shuffle(rng, [
    ...Array.from({ length: spec.iron }, () => 'iron' as const),
    ...Array.from({ length: spec.uranium }, () => 'uranium' as const),
  ]);
  const spots = placeVeins(types.length, ROCK_ZONES[spec.bg], rng);
  return {
    index,
    bg: spec.bg,
    oilSeconds: spec.oilSeconds,
    lampRadius: spec.lampRadius,
    bats: spec.bats,
    veins: types.map((type, id) => ({ id, ...spots[id], type, hitsLeft: HITS })),
    drips: Array.from({ length: spec.drips }, () => ({
      x: Math.round(DRIP_MARGIN + rng() * (1920 - 2 * DRIP_MARGIN)),
      periodS: DRIP_PERIOD.min + rng() * (DRIP_PERIOD.max - DRIP_PERIOD.min),
    })),
  };
}

/**
 * Rejection sampling: a random zone, a random point in it, kept when it is VEIN_GAP away from every
 * vein so far, at most MAX_TRIES tries per vein. Early veins can jam a narrow zone; then the whole
 * layout starts over, and only after LAYOUTS jammed layouts does a vein take the roomiest spot seen.
 */
function placeVeins(n: number, zones: Zone[], rng: () => number): { x: number; y: number }[] {
  for (let layout = 1; ; layout++) {
    const last = layout === LAYOUTS;
    const placed: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p = placeOne(placed, zones, rng);
      if (p.gap < VEIN_GAP && !last) break;
      placed.push(p.at);
    }
    if (placed.length === n) return placed;
  }
}

const LAYOUTS = 50;

function placeOne(placed: { x: number; y: number }[], zones: Zone[], rng: () => number) {
  let at = { x: zones[0].x0, y: zones[0].y0 };
  let gap = -1;
  for (let attempt = 0; attempt < MAX_TRIES && gap < VEIN_GAP; attempt++) {
    const z = zones[Math.floor(rng() * zones.length)];
    const p = { x: Math.round(z.x0 + rng() * (z.x1 - z.x0)), y: Math.round(z.y0 + rng() * (z.y1 - z.y0)) };
    const g = Math.min(Infinity, ...placed.map((q) => dist(p, q)));
    if (g > gap) {
      at = p;
      gap = g;
    }
  }
  return { at, gap };
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isLit(lamp: { x: number; y: number }, p: { x: number; y: number }, radiusPx: number): boolean {
  return dist(lamp, p) <= radiusPx;
}

/** Geiger counter: by the nearest uranium vein not yet mined; <160 px → 3, <360 → 2, <640 → 1, else 0. */
export function geigerLevel(lamp: { x: number; y: number }, veins: Vein[]): 0 | 1 | 2 | 3 {
  const d = Math.min(Infinity, ...veins.filter((v) => v.type === 'uranium' && v.hitsLeft > 0).map((v) => dist(lamp, v)));
  return d < 160 ? 3 : d < 360 ? 2 : d < 640 ? 1 : 0;
}

export function hit(vein: Vein): Vein {
  return { ...vein, hitsLeft: Math.max(0, vein.hitsLeft - 1) };
}

export function minedCount(veins: Vein[]): number {
  return veins.filter((v) => v.hitsLeft === 0).length;
}

export function starsFor(mined: number, total: number): 1 | 2 | 3 {
  const f = mined / total;
  return f >= 1 ? 3 : f >= 0.6 ? 2 : 1;
}
