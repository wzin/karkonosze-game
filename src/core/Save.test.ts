import { it, expect } from 'vitest';
import { Save } from './Save';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

it('keeps best stars and survives missing storage', () => {
  const s = new Save(null);
  s.record('glass', 2);
  s.record('glass', 1);
  expect(s.load().games.glass.stars).toBe(2);
});

it('ignores a throwing storage', () => {
  const bad = {
    getItem: () => { throw new Error('x'); },
    setItem: () => { throw new Error('x'); },
  };
  const s = new Save(bad);
  expect(() => s.record('mine', 3)).not.toThrow();
  expect(s.load().games.mine.stars).toBe(3);
});

it('persists under bk.save.v1 and reads it back', () => {
  const storage = memoryStorage();
  new Save(storage).record('herbs', 3, true);
  expect(storage.items.has('bk.save.v1')).toBe(true);
  const game = new Save(storage).load().games.herbs;
  expect(game.stars).toBe(3);
  expect(game.field).toBe(true);
  expect(Number.isNaN(Date.parse(game.playedAt))).toBe(false);
});

it('starts empty when stored data is corrupt', () => {
  const storage = memoryStorage();
  storage.setItem('bk.save.v1', '{not json');
  expect(new Save(storage).load()).toEqual({ version: 1, games: {} });
});
