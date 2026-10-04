import { it, expect } from 'vitest';
import { I18n } from './I18n';

it('merges and interpolates', () => {
  const i = new I18n({ a: { b: 'x {n}' } }, { a: { c: 'y' } });
  expect(i.t('a.b', { n: 3 })).toBe('x 3');
  expect(i.t('a.c')).toBe('y');
  expect(i.t('zz')).toBe('zz');
});

it('lets later dictionaries override earlier ones', () => {
  const i = new I18n({ ui: { back: 'old', play: 'p' } }, { ui: { back: 'new' } });
  expect(i.t('ui.back')).toBe('new');
  expect(i.t('ui.play')).toBe('p');
});

it('returns the key for non-text values and keeps unknown placeholders', () => {
  const i = new I18n({ a: { b: 'x {n} {m}' } });
  expect(i.t('a')).toBe('a');
  expect(i.t('a.b', { n: 1 })).toBe('x 1 {m}');
});

it('gets structured values such as arrays', () => {
  const i = new I18n({ places: [{ id: 'kowary' }] });
  expect(i.get<{ id: string }[]>('places')[0].id).toBe('kowary');
  expect(i.get('nope')).toBeUndefined();
});
