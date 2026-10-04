import { it, expect, vi, afterEach } from 'vitest';

// jsdom has no 2D canvas; Pixi probes one on import and jsdom would log "Not implemented".
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import { Assets, Texture } from 'pixi.js';
import { AssetRegistry, sprite } from './Assets';

afterEach(() => vi.restoreAllMocks());

it('falls back to white texture for unknown alias', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const r = new AssetRegistry({ assets: {} });
  expect(r.has('hub/sky')).toBe(false);
  expect(r.texture('hub/sky')).toBe(Texture.WHITE);
});

it('warns once per missing alias', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const r = new AssetRegistry({ assets: {} });
  r.texture('hub/sky');
  r.texture('hub/sky');
  r.texture('hub/moon');
  expect(warn).toHaveBeenCalledTimes(2);
});

it('knows manifest sizes even before loading', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const r = new AssetRegistry({ assets: { 'hub/sky': { src: 'gfx/hub/sky.webp', w: 1920, h: 1080 } } });
  expect(r.size('hub/sky')).toEqual({ w: 1920, h: 1080 });
  expect(r.size('hub/moon')).toBeNull();
  expect(r.has('hub/sky')).toBe(false);
  expect(r.texture('hub/sky')).toBe(Texture.WHITE);
});

it('builds a tinted placeholder sprite for a missing alias', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const r = new AssetRegistry({ assets: {} });
  const s = sprite(r, 'mine/bat', { w: 120, h: 80 });
  expect(s.texture).toBe(Texture.WHITE);
  expect(s.width).toBe(120);
  expect(s.height).toBe(80);
  expect(s.tint).toBe(0x8899aa);
  expect(sprite(r, 'mine/bat', { w: 10, h: 10, tint: 0xff0000 }).tint).toBe(0xff0000);
});

it('loads one prefix as a bundle of /assets/ urls, once', async () => {
  const addBundle = vi.spyOn(Assets, 'addBundle').mockImplementation(() => {});
  const load = vi.spyOn(Assets, 'load').mockResolvedValue({});
  const r = new AssetRegistry({
    assets: {
      'hub/sky': { src: 'gfx/hub/sky.webp', w: 1920, h: 1080 },
      'hub/ridge': { src: 'gfx/hub/ridge.webp', w: 1920, h: 600 },
      'hubris/x': { src: 'gfx/hubris/x.webp', w: 1, h: 1 },
      'mine/bat': { src: 'gfx/mine/bat.webp', w: 200, h: 120 },
    },
  });
  await Promise.all([r.loadGroup('hub'), r.loadGroup('hub')]);
  expect(addBundle).toHaveBeenCalledOnce();
  expect(addBundle).toHaveBeenCalledWith('hub', [
    { alias: 'hub/sky', src: '/assets/gfx/hub/sky.webp' },
    { alias: 'hub/ridge', src: '/assets/gfx/hub/ridge.webp' },
  ]);
  expect(load).toHaveBeenCalledOnce();
});

it('hands out a loaded texture and reports it with has()', () => {
  const tex = new Texture();
  Assets.cache.set('herbs/arnica', tex);
  const r = new AssetRegistry({ assets: { 'herbs/arnica': { src: 'gfx/herbs/arnica.webp', w: 90, h: 140 } } });
  expect(r.has('herbs/arnica')).toBe(true);
  expect(r.texture('herbs/arnica')).toBe(tex);
  expect(sprite(r, 'herbs/arnica').texture).toBe(tex);
  Assets.cache.remove('herbs/arnica');
});
