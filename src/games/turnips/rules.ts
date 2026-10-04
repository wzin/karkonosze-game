import { shuffle } from '../../core/Rng';

/** WeatherFilter modes: 0 none, 1 fog, 2 rain, 3 snow, 4 sun. */
export type Weather = 0 | 1 | 2 | 3 | 4;

export interface Wave {
  round: number;
  /** Turnips to count. */
  count: number;
  /** Stones popping up among them (not counted). */
  decoys: number;
  /** How long one group stays up. */
  showMs: number;
  /** Pause between two groups. */
  gapMs: number;
  weather: Weather;
  groups: number;
}

export const ROUNDS = 5;

export function roundConfig(round: number): Wave {
  const table: Omit<Wave, 'round'>[] = [
    { count: 4, decoys: 0, showMs: 1800, gapMs: 500, weather: 0, groups: 2 },
    { count: 6, decoys: 1, showMs: 1500, gapMs: 450, weather: 4, groups: 3 },
    { count: 8, decoys: 2, showMs: 1300, gapMs: 400, weather: 1, groups: 3 },
    { count: 11, decoys: 3, showMs: 1100, gapMs: 350, weather: 2, groups: 4 },
    { count: 14, decoys: 4, showMs: 900, gapMs: 300, weather: 3, groups: 4 },
  ];
  return { round, ...table[Math.min(Math.max(round, 1), ROUNDS) - 1] };
}

/**
 * Splits `count` turnips into `groups` waves: the sum is `count`, every group has at least one, and
 * none grows past ceil(count / groups) + 1, so a single group stays countable at a glance. With fewer
 * turnips than groups there is one group per turnip.
 */
export function splitIntoGroups(rng: () => number, count: number, groups: number): number[] {
  const n = Math.max(0, Math.floor(count));
  const g = Math.min(Math.max(1, Math.floor(groups)), n);
  if (g === 0) return [];
  const cap = Math.ceil(n / g) + 1;
  const out = new Array<number>(g).fill(1);
  for (let left = n - g; left > 0; left--) {
    const open = out.flatMap((size, i) => (size < cap ? [i] : []));
    out[open[Math.floor(rng() * open.length)]]++;
  }
  return out;
}

/** Four different answers ≥ 0, shuffled: the correct one and three within ±3 of it. */
export function answerOptions(rng: () => number, correct: number): number[] {
  const near: number[] = [];
  for (let d = -3; d <= 3; d++) if (d !== 0 && correct + d >= 0) near.push(correct + d);
  return shuffle(rng, [correct, ...shuffle(rng, near).slice(0, 3)]);
}

/**
 * The dark furrows of `turnips/bg`: the back row runs along the meadow's edge from x0 to x1, the
 * front row along the bottom of the screen. Each row starts `shear` of a spacing further right than
 * the one behind it, so neighbouring rows interleave like bricks (no turnip stands right in front of
 * another) and the patch leans with the field's diagonal right edge.
 */
export const FIELD = {
  back: { y: 836, x0: 100, x1: 930 },
  front: { y: 1028 },
  shear: 0.5,
};

/** Mound positions (design px), row by row from the back of the field to the front. */
export function fieldSlots(cols = 6, rows = 3): { x: number; y: number }[] {
  const { back, front, shear } = FIELD;
  const spacing = cols === 1 ? 0 : (back.x1 - back.x0) / (cols - 1);
  const x0 = cols === 1 ? (back.x0 + back.x1) / 2 : back.x0;
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const y = rows === 1 ? front.y : lerp(back.y, front.y, r / (rows - 1));
    for (let c = 0; c < cols; c++) {
      out.push({ x: Math.round(x0 + (c + r * shear) * spacing), y: Math.round(y) });
    }
  }
  return out;
}

export function starsFor(correctRounds: number, total = ROUNDS): 1 | 2 | 3 {
  return correctRounds >= total ? 3 : correctRounds >= 3 ? 2 : 1;
}

/** One thing popping out of a mound: a turnip, or a stone that must not be counted. */
export interface Pop {
  slot: number;
  stone: boolean;
}

/**
 * The groups of one wave: `count` turnips split by splitIntoGroups, the stones spread over different
 * groups, every item on its own mound (no mound twice in a wave). Stones that do not fit are dropped.
 */
export function planWave(rng: () => number, wave: Wave, slots: number): Pop[][] {
  const sizes = splitIntoGroups(rng, Math.min(wave.count, slots), wave.groups);
  const free = shuffle(rng, Array.from({ length: slots }, (_, i) => i));
  const stones = new Array<number>(sizes.length).fill(0);
  const decoys = Math.min(wave.decoys, slots - Math.min(wave.count, slots));
  const order = shuffle(rng, sizes.map((_, i) => i));
  for (let d = 0; d < decoys && order.length > 0; d++) stones[order[d % order.length]]++;

  let next = 0;
  return sizes.map((turnips, g) => {
    const group: Pop[] = [];
    for (let i = 0; i < turnips; i++) group.push({ slot: free[next++], stone: false });
    for (let i = 0; i < stones[g]; i++) group.push({ slot: free[next++], stone: true });
    // the scene pops a group one item after another: stones must not always come last
    return shuffle(rng, group);
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
