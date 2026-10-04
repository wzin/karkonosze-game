import { it, expect, beforeEach } from 'vitest';
import { Audio } from './Audio';

beforeEach(() => localStorage.clear());

it('resolves first available candidate', () => {
  const a = new Audio({ pop: ['glass/pop', 'ui/tap'] }, '/x/', new Set(['ui/tap']));
  expect(a.resolve('pop')).toBe('ui/tap');
  expect(a.resolve('nope')).toBeNull();
});

it('plays nothing when no candidate is available', () => {
  const a = new Audio({ pop: ['glass/pop'] }, '/x/', new Set());
  expect(a.play('pop')).toBeUndefined();
  expect(a.play('unknown')).toBeUndefined();
});

it('remembers the muted flag in localStorage', () => {
  const a = new Audio({}, undefined, new Set());
  expect(a.muted).toBe(false);
  a.setMuted(true);
  expect(localStorage.getItem('bk.muted')).toBe('1');
  expect(new Audio({}, undefined, new Set()).muted).toBe(true);
});
