import { it, expect, vi } from 'vitest';
import manifest from '../../public/assets/audio/manifest.json';

vi.mock('howler', () => ({ Howl: class {}, Howler: { mute: () => {} } }));

import { Audio } from './Audio';
import { MOMENTS } from './moments';

const clips = new Set(Object.keys(manifest.clips));
const candidates = Object.values(MOMENTS).flat();

it('names every moment <area>.<name>', () => {
  for (const moment of Object.keys(MOMENTS)) expect(moment).toMatch(/^[a-z]+\.[a-z][a-zA-Z]*$/);
});

it('names every candidate clip <category>/<id>', () => {
  for (const clip of candidates) expect(clip).toMatch(/^[a-z]+\/[a-z][a-z_]*$/);
});

it('gives every moment at least one candidate', () => {
  for (const [moment, list] of Object.entries(MOMENTS)) expect(list.length, moment).toBeGreaterThan(0);
});

it('lists only clips that exist in the audio manifest', () => {
  for (const clip of candidates) expect(clips.has(clip), clip).toBe(true);
});

it('ends every fallback chain on a shared ui/ clip', () => {
  for (const [moment, list] of Object.entries(MOMENTS)) {
    if (list.length > 1) expect(list.at(-1), moment).toMatch(/^ui\//);
  }
});

it('reaches every clip of the manifest from some moment', () => {
  const used = new Set(candidates);
  for (const clip of clips) expect(used.has(clip), clip).toBe(true);
});

it('covers the shared UI moments', () => {
  expect(Object.keys(MOMENTS)).toEqual(expect.arrayContaining(['ui.tap', 'ui.success', 'ui.fail', 'ui.star']));
});

it('falls back to the generic clip when the specific one is missing', () => {
  const full = new Audio(MOMENTS, '', clips);
  expect(full.resolve('glass.pop')).toBe('glass/pop');
  const partial = new Audio(MOMENTS, '', new Set([...clips].filter((c) => c !== 'glass/pop')));
  expect(partial.resolve('glass.pop')).toBe('ui/fail');
});
