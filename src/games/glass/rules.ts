import { shuffle } from '../../core/Rng';

export type MineralId = 'kobalt' | 'zelazo' | 'zloto' | 'mangan' | 'uran';
export type ShapeId = 'puchar' | 'butla' | 'flakon' | 'kula' | 'wazon';
export type SizeId = 'maly' | 'duzy';
export interface Customer {
  id: 'hrabina' | 'walon' | 'laborant' | 'duch' | 'pohl';
  shape: ShapeId;
  mineral: MineralId;
  size: SizeId;
}

/** Metal oxides on the shelf and the colour each one gives the glass. */
export const MINERALS: { id: MineralId; tint: number }[] = [
  { id: 'kobalt', tint: 0x3a6fd8 },
  { id: 'zelazo', tint: 0x3f8f5a },
  { id: 'zloto', tint: 0xc2304a },
  { id: 'mangan', tint: 0x7d4fa3 },
  { id: 'uran', tint: 0xb9d93a },
];
export const SHAPES: ShapeId[] = ['puchar', 'butla', 'flakon', 'kula', 'wazon'];
export const CUSTOMERS: Customer[] = [
  { id: 'hrabina', shape: 'puchar', mineral: 'zloto', size: 'duzy' },
  { id: 'walon', shape: 'butla', mineral: 'zelazo', size: 'maly' },
  { id: 'laborant', shape: 'flakon', mineral: 'mangan', size: 'maly' },
  { id: 'duch', shape: 'kula', mineral: 'kobalt', size: 'duzy' },
  { id: 'pohl', shape: 'wazon', mineral: 'uran', size: 'duzy' },
];

/** The ember zone is 0.5 ± zoneHalf on the gauge; outside it the glass is ash-cold or burnt. */
export const HEAT = { zoneHalf: 0.19, missScore: 0.15 };
/**
 * Bubble radii in design px; above target × popFactor it bursts. popFactor 1.5 and growPerSec 120
 * (controller ruling over the brief's 1.3 / 140) leave 0.48 s (small) to 0.65 s (large) between
 * reaching the ring and the burst, instead of 0.25–0.34 s.
 */
export const BLOW = { target: { maly: 150, duzy: 230 }, popFactor: 1.5, growPerSec: 120, popPenalty: 0.7 };
/** A burst may be retried once: the second one ends the move. */
export const MAX_POPS = 2;
/** Seconds per step; when one runs out the step resolves with what the player has so far. */
export const LIMITS = { heat: 12, blow: 20, color: 15, shape: 15 } as const;
/** Below these part scores the result card explains what went wrong. */
export const NOTE_BELOW = { blow: 0.6, heat: 0.5 } as const;

export function heatScore(pos: number): number {
  const d = Math.abs(pos - 0.5);
  return d <= HEAT.zoneHalf ? 1 - d * 2 : HEAT.missScore;
}

/** Needle position 0..1 at `t` seconds into the heat step. */
export function needlePos(t: number): number {
  return (Math.sin(t * 2.6) + 1) / 2;
}

export function blowScore(r: number, target: number, pops: number): number {
  const err = Math.abs(r - target) / target;
  return Math.max(0.1, 1 - err * 2.2) * (pops ? BLOW.popPenalty : 1);
}

export function popped(r: number, target: number): boolean {
  return r > target * BLOW.popFactor;
}

/** One frame of blowing: the bubble grows faster the bigger it gets. */
export function grow(r: number, dt: number): number {
  return r + BLOW.growPerSec * dt * (1 + r / 600);
}

/**
 * The blow move as a state machine. Only `blowing` grows the bubble. After a burst (`popped`) the
 * fresh gather comes back (`gatherBack`) as `ready`, or as `closing` when that was the last allowed
 * burst or the time ran out meanwhile; `closing` ignores input and only ends (`closed`) in `done`.
 */
export type BlowState = 'ready' | 'blowing' | 'popped' | 'closing' | 'done';
export type BlowEvent = 'hold' | 'release' | 'tap' | 'burst' | 'gatherBack' | 'closed' | 'timeUp';

export function nextBlowState(state: BlowState, event: BlowEvent, ctx: { pops: number; expired: boolean }): BlowState {
  switch (state) {
    case 'ready':
      return event === 'hold' ? 'blowing' : event === 'timeUp' ? 'done' : state;
    case 'blowing':
      if (event === 'release' || event === 'timeUp') return 'done';
      if (event === 'tap') return 'ready';
      return event === 'burst' ? 'popped' : state;
    case 'popped':
      if (event !== 'gatherBack') return state;
      return ctx.pops >= MAX_POPS || ctx.expired ? 'closing' : 'ready';
    case 'closing':
      return event === 'closed' ? 'done' : state;
    case 'done':
      return state;
  }
}

/** Whether the bubble grows (and the ring reacts) in this state. */
export function blowGrows(state: BlowState): boolean {
  return state === 'blowing';
}

export function orderScore(p: { heat: number; blow: number; mineralOk: boolean; shapeOk: boolean }): number {
  return p.heat + p.blow + (p.mineralOk ? 1 : 0) + (p.shapeOk ? 1 : 0);
}

export function starsFor(score: number): 1 | 2 | 3 {
  return score >= 3.3 ? 3 : score >= 2.1 ? 2 : 1;
}

export function pickOrders(rng: () => number, n = 3): Customer[] {
  return shuffle(rng, CUSTOMERS).slice(0, n);
}

export function summaryTitle(total: number): 'master' | 'glassblower' | 'apprentice' {
  return total >= 8 ? 'master' : total >= 5 ? 'glassblower' : 'apprentice';
}

export function reactionKey(stars: 1 | 2 | 3): 'ok' | 'meh' | 'bad' {
  return stars === 3 ? 'ok' : stars === 2 ? 'meh' : 'bad';
}

/** The hub badge holds 1..3 stars: the summary title tier of the 9-star total. */
export function saveStars(total: number): 1 | 2 | 3 {
  const title = summaryTitle(total);
  return title === 'master' ? 3 : title === 'glassblower' ? 2 : 1;
}

export interface Made {
  heat: number;
  blow: number;
  mineral: MineralId;
  shape: ShapeId;
}

/** Which `glass.notes.*` lines the result card shows, in reading order. */
export function noteKeys(order: Customer, made: Made): ('color' | 'shape' | 'size' | 'heat')[] {
  const notes: ('color' | 'shape' | 'size' | 'heat')[] = [];
  if (made.mineral !== order.mineral) notes.push('color');
  if (made.shape !== order.shape) notes.push('shape');
  if (made.blow < NOTE_BELOW.blow) notes.push('size');
  if (made.heat < NOTE_BELOW.heat) notes.push('heat');
  return notes;
}

export function mineralTint(id: MineralId): number {
  return MINERALS.find((m) => m.id === id)?.tint ?? 0xffffff;
}
