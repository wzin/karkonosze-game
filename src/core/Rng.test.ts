import { it, expect } from 'vitest';
import { mulberry32, pick, shuffle } from './Rng';

it('is deterministic', () => {
  expect(mulberry32(7)()).toBe(mulberry32(7)());
  expect(shuffle(mulberry32(1), [1, 2, 3, 4])).toHaveLength(4);
});

it('yields numbers in [0, 1) that differ between seeds', () => {
  const rng = mulberry32(42);
  const values = Array.from({ length: 1000 }, rng);
  expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  expect(mulberry32(1)()).not.toBe(mulberry32(2)());
});

it('shuffles into a permutation without touching the input', () => {
  const input = [1, 2, 3, 4, 5, 6] as const;
  const out = shuffle(mulberry32(3), input);
  expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(input).toEqual([1, 2, 3, 4, 5, 6]);
});

it('picks an element of the array', () => {
  const arr = ['a', 'b', 'c'];
  const rng = mulberry32(9);
  for (let i = 0; i < 50; i++) expect(arr).toContain(pick(rng, arr));
});
