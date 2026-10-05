import { describe, it, expect } from 'vitest';
import content from '../content/pl.json';
import { GAMES } from '../games';
import { approach, parallaxTarget } from './Parallax';
import {
  gameFor,
  layoutLabels,
  markerBadge,
  markerKind,
  sentenceCase,
  labelLines,
  type LabelItem,
  type Rect,
} from './rules';

describe('markerBadge', () => {
  const save = { games: { glass: { stars: 2, playedAt: '2026-10-04T10:00:00Z' } } };

  it('reads the stars of the game played at a place', () => {
    expect(markerBadge(save, GAMES, 'szklarska')).toBe(2);
  });

  it('is 0 for an unplayed game, a place without a game and an unknown place', () => {
    expect(markerBadge(save, GAMES, 'kowary')).toBe(0);
    expect(markerBadge(save, GAMES, 'chojnik')).toBe(0);
    expect(markerBadge(save, GAMES, 'nowhere')).toBe(0);
    expect(markerBadge({ games: {} }, GAMES, 'szklarska')).toBe(0);
  });

  it('clamps a corrupt record to 0..3', () => {
    const odd = { games: { glass: { stars: 7, playedAt: '' }, mine: { stars: -1, playedAt: '' } } };
    expect(markerBadge(odd, GAMES, 'szklarska')).toBe(3);
    expect(markerBadge(odd, GAMES, 'kowary')).toBe(0);
  });
});

describe('markers', () => {
  it('maps places to games through the registry', () => {
    expect(gameFor(GAMES, 'szklarska')).toBe('glass');
    expect(gameFor(GAMES, 'sniezka')).toBe('turnips');
    expect(gameFor(GAMES, 'jelenia')).toBeNull();
  });

  it('keeps the game field of content places (read by nothing, the registry decides) in step with GAMES', () => {
    const places = content.places as { id: string; game?: string }[];
    const fromContent = places.filter((p) => p.game).map((p) => `${p.id}:${p.game}`);
    const fromRegistry = GAMES.map((g) => `${g.placeId}:${g.id}`);
    expect(fromContent.sort()).toEqual(fromRegistry.sort());
  });

  it('tells the hub, game and concept markers apart', () => {
    expect(markerKind({ id: 'staniszow', hub: true }, GAMES)).toBe('hub');
    expect(markerKind({ id: 'kowary' }, GAMES)).toBe('game');
    expect(markerKind({ id: 'cieplice' }, GAMES)).toBe('concept');
  });

  it('labels a place with its name, the part after the first comma on a second line', () => {
    expect(labelLines('Śnieżka, 1603 m')).toEqual(['Śnieżka', '1603 m']);
    expect(labelLines('Łomnica, Wojanów, Bukowiec')).toEqual(['Łomnica', 'Wojanów, Bukowiec']);
    expect(labelLines('Cieplice Śląskie-Zdrój')).toEqual(['Cieplice Śląskie-Zdrój', '']);
  });

  it('capitalises a sentence that starts lower-case', () => {
    expect(sentenceCase('grasz Duchem Gór.')).toBe('Grasz Duchem Gór.');
    expect(sentenceCase('Łódka')).toBe('Łódka');
    expect(sentenceCase('')).toBe('');
  });

  it('places every marker of the content inside the design space', () => {
    for (const p of content.places) {
      expect(p.x, p.id).toBeGreaterThan(40);
      expect(p.x, p.id).toBeLessThan(1880);
      expect(p.y, p.id).toBeGreaterThan(300);
      expect(p.y, p.id).toBeLessThan(1040);
    }
  });
});

describe('layoutLabels', () => {
  const bounds: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
  const overlap = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const dot = (m: LabelItem): Rect => ({ x: m.x - 12, y: m.y - 12, w: 24, h: 24 });

  it('puts a lone label to the right of its dot, centred on it', () => {
    const [l] = layoutLabels([{ id: 'a', x: 500, y: 500, w: 120, h: 36 }], { bounds });
    expect(l.id).toBe('a');
    expect(l.x).toBeGreaterThan(500);
    expect(l.y + l.h / 2).toBe(500);
  });

  it('lines up the given line of a two-line label with the dot', () => {
    const [l] = layoutLabels([{ id: 'a', x: 500, y: 500, w: 120, h: 56, cy: 16 }], { bounds });
    expect(l.y + 16).toBe(500);
  });

  it('flips a label left at the right edge of the screen', () => {
    const [l] = layoutLabels([{ id: 'a', x: 1880, y: 500, w: 200, h: 36 }], { bounds });
    expect(l.x + l.w).toBeLessThan(1880);
    expect(l.x).toBeGreaterThanOrEqual(0);
  });

  it('keeps labels of crowded markers off each other and off every dot', () => {
    const items: LabelItem[] = [
      { id: 'a', x: 400, y: 400, w: 160, h: 36 },
      { id: 'b', x: 430, y: 420, w: 140, h: 36 },
      { id: 'c', x: 380, y: 440, w: 180, h: 36 },
      { id: 'd', x: 520, y: 410, w: 120, h: 36 },
    ];
    const placed = layoutLabels(items, { bounds });
    expect(placed.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
    for (const l of placed) {
      for (const other of placed) if (other !== l) expect(overlap(l, other), `${l.id}/${other.id}`).toBe(0);
      for (const m of items) expect(overlap(l, dot(m)), `${l.id} on dot ${m.id}`).toBe(0);
    }
  });

  it('keeps clear of obstacles such as the title', () => {
    const title: Rect = { x: 0, y: 0, w: 900, h: 220 };
    const [l] = layoutLabels([{ id: 'a', x: 300, y: 240, w: 160, h: 36 }], { bounds, obstacles: [title] });
    expect(overlap(l, title)).toBe(0);
  });
});

describe('parallax', () => {
  it('moves layers against the pointer, up to the amplitude at the edges', () => {
    expect(parallaxTarget(960, 540)).toEqual({ x: 0, y: 0 });
    expect(parallaxTarget(1920, 1080)).toEqual({ x: -40, y: -40 });
    expect(parallaxTarget(0, 540)).toEqual({ x: 40, y: 0 });
    expect(parallaxTarget(-500, 3000)).toEqual({ x: 40, y: -40 });
  });

  it('eases towards the target at the given rate, never overshooting', () => {
    expect(approach(0, 10, 3, 0)).toBe(0);
    const step = approach(0, 10, 3, 1 / 60);
    expect(step).toBeGreaterThan(0.45);
    expect(step).toBeLessThan(0.5);
    expect(approach(0, 10, 3, 10)).toBeCloseTo(10, 6);
    expect(approach(0, 10, 3, 10)).toBeLessThanOrEqual(10);
  });
});
