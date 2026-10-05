import { describe, it, expect, vi } from 'vitest';

// jsdom has no canvas; Pixi probes one on import and when it picks a shader precision.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

import type { Filter, FilterSystem, RenderSurface, Texture } from 'pixi.js';
import { AerialFilter } from './AerialFilter';
import { FogFilter } from './FogFilter';
import { HeatHazeFilter } from './HeatHazeFilter';
import { LampLightFilter } from './LampLightFilter';
import { AERIAL_FRAG, FILTER_VERTEX, FOG_FRAG, HEAT_HAZE_FRAG, LAMP_LIGHT_FRAG, WEATHER_FRAG } from './shaders';
import { WeatherFilter } from './WeatherFilter';

const FRAGMENTS = { HEAT_HAZE_FRAG, FOG_FRAG, LAMP_LIGHT_FRAG, WEATHER_FRAG, AERIAL_FRAG };

/** Uniforms Pixi's filter system fills in itself (global filter uniforms and the input texture). */
const BUILT_IN = new Set(['uTexture', 'uInputSize', 'uInputPixel', 'uInputClamp', 'uOutputFrame', 'uGlobalFrame', 'uOutputTexture']);

function declaredUniforms(src: string): string[] {
  return [...src.matchAll(/\buniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]);
}

/** Every `uSomething` identifier the source mentions. */
function referencedUniforms(src: string): string[] {
  return [...new Set([...src.matchAll(/\bu[A-Z]\w*/g)].map((m) => m[0]))];
}

describe.each(Object.entries(FRAGMENTS))('%s', (_name, src) => {
  it('is a GLSL 300 es filter fragment', () => {
    expect(src).toContain('finalColor');
    expect(src).toContain('vTextureCoord');
    expect(src).not.toContain('gl_FragColor');
    expect(src).not.toContain('texture2D');
    // Pixi compiles a fragment as 300 es only when it carries this header (it strips and re-inserts it)
    expect(src.trimStart().startsWith('#version 300 es')).toBe(true);
  });

  it('declares every uniform it uses', () => {
    const declared = new Set(declaredUniforms(src));
    for (const name of referencedUniforms(src)) expect(declared.has(name), name).toBe(true);
  });
});

it('loads pixi-filters for the glow effects of later tasks', async () => {
  const { AdvancedBloomFilter, GlowFilter } = await import('pixi-filters');
  expect(typeof AdvancedBloomFilter).toBe('function');
  expect(typeof GlowFilter).toBe('function');
});

it('shares the standard filter vertex shader', () => {
  expect(FILTER_VERTEX).toContain('aPosition');
  expect(FILTER_VERTEX).toContain('vTextureCoord');
  expect(FILTER_VERTEX).toContain('gl_Position');
});

const FILTERS: [string, () => Filter, string, string][] = [
  ['HeatHazeFilter', () => new HeatHazeFilter(), HEAT_HAZE_FRAG, 'heatHazeUniforms'],
  ['FogFilter', () => new FogFilter(), FOG_FRAG, 'fogUniforms'],
  ['LampLightFilter', () => new LampLightFilter(), LAMP_LIGHT_FRAG, 'lampLightUniforms'],
  ['WeatherFilter', () => new WeatherFilter(), WEATHER_FRAG, 'weatherUniforms'],
  ['AerialFilter', () => new AerialFilter(), AERIAL_FRAG, 'aerialUniforms'],
];

it.each(FILTERS)('%s declares exactly the custom uniforms of its fragment', (_name, make, src, group) => {
  const filter = make();
  const custom = declaredUniforms(src).filter((n) => !BUILT_IN.has(n));
  expect(Object.keys(filter.resources[group].uniforms).sort()).toEqual(custom.sort());
});

it('HeatHazeFilter writes its parameters to the uniforms', () => {
  const f = new HeatHazeFilter();
  const u = f.resources.heatHazeUniforms.uniforms;
  f.time = 2.5;
  f.intensity = 0.4;
  f.rect = [0.1, 0.2, 0.3, 0.4];
  expect(u.uTime).toBe(2.5);
  expect(u.uIntensity).toBe(0.4);
  expect(Array.from(u.uRect as ArrayLike<number>)).toEqual([0.1, 0.2, 0.3, 0.4].map(Math.fround));
  expect(f.rect.map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.2, 0.3, 0.4]);
});

it('HeatHazeFilter clamps intensity to 0..1', () => {
  const f = new HeatHazeFilter();
  f.intensity = 3;
  expect(f.intensity).toBe(1);
  f.intensity = -1;
  expect(f.intensity).toBe(0);
});

it('FogFilter writes its parameters to the uniforms', () => {
  const f = new FogFilter();
  const u = f.resources.fogUniforms.uniforms;
  f.time = 1;
  f.density = 0.35;
  f.color = [0.5, 0.25, 1];
  f.drift = 0.1;
  f.bottom = 0.55;
  expect(u.uEnd).toBe(1);
  f.end = 0.8;
  expect(u.uTime).toBe(1);
  expect(u.uDensity).toBe(0.35);
  expect(Array.from(u.uColor as ArrayLike<number>)).toEqual([0.5, 0.25, 1]);
  expect(u.uDrift).toBe(0.1);
  expect(u.uBottom).toBe(0.55);
  expect(u.uEnd).toBe(0.8);
  expect(f.color).toEqual([0.5, 0.25, 1]);
  f.end = 3;
  expect(f.end).toBe(1);
});

it('FogFilter keeps end above bottom whichever is set first', () => {
  const f = new FogFilter();
  const u = f.resources.fogUniforms.uniforms;
  f.bottom = 0.2;
  f.end = 0.5;
  expect(u.uEnd).toBe(0.5);
  // a bottom raised past end lifts the end uniform just above it...
  f.bottom = 0.7;
  expect(u.uEnd).toBeCloseTo(0.71, 6);
  // ...and the end asked for comes back once bottom allows it
  f.bottom = 0.3;
  expect(u.uEnd).toBe(0.5);
  f.end = 0.1;
  expect(u.uEnd).toBeCloseTo(0.31, 6);
  f.bottom = 2;
  expect(u.uBottom).toBe(0.99);
  expect(u.uEnd).toBe(1);
});

it('LampLightFilter writes its parameters to the uniforms', () => {
  const f = new LampLightFilter();
  const u = f.resources.lampLightUniforms.uniforms;
  f.light = [0.25, 0.75];
  f.radius = 0.3;
  f.ambient = 0.06;
  f.flicker = 0.15;
  f.time = 4;
  expect(Array.from(u.uLight as ArrayLike<number>)).toEqual([0.25, 0.75]);
  expect(u.uRadius).toBe(0.3);
  expect(u.uAmbient).toBe(0.06);
  expect(u.uFlicker).toBe(0.15);
  expect(u.uTime).toBe(4);
  expect(f.light).toEqual([0.25, 0.75]);
});

it('AerialFilter writes its parameters to the uniforms, clamped', () => {
  const f = new AerialFilter();
  const u = f.resources.aerialUniforms.uniforms;
  expect(u.uHaze).toBe(0);
  f.width = 1.5;
  f.darken = 0.25;
  f.haze = 0.5;
  f.hazeColor = [0.5, 0.25, 1];
  expect(u.uWidth).toBe(1.5);
  expect(u.uDarken).toBe(0.25);
  expect(u.uHaze).toBe(0.5);
  expect(Array.from(u.uHazeColor as ArrayLike<number>)).toEqual([0.5, 0.25, 1]);
  expect(f.hazeColor).toEqual([0.5, 0.25, 1]);
  f.width = -1;
  f.darken = 2;
  f.haze = -0.5;
  f.hazeColor = [-0.2, 0.5, 1.4];
  expect(f.width).toBe(0);
  expect(f.darken).toBe(1);
  expect(f.haze).toBe(0);
  expect(f.hazeColor).toEqual([0, 0.5, 1]);
});

it('AerialFilter renders at the renderer resolution and feathers in logical px', () => {
  const f = new AerialFilter();
  expect(f.resolution).toBe('inherit');
  f.width = 1;
  const u = f.resources.aerialUniforms.uniforms;
  const applyFilter = vi.fn();
  const run = (resolution: number) =>
    f.apply({ applyFilter } as unknown as FilterSystem, { source: { resolution } } as unknown as Texture, {} as RenderSurface, true);
  // a DPR 2 input has two pixels per logical px: the ring doubles in input pixels
  run(2);
  expect(u.uWidth).toBe(2);
  run(1);
  expect(u.uWidth).toBe(1);
  expect(applyFilter).toHaveBeenCalledTimes(2);
  expect(f.width).toBe(1);
});

it('WeatherFilter writes its parameters to the uniforms', () => {
  const f = new WeatherFilter();
  const u = f.resources.weatherUniforms.uniforms;
  expect(f.mode).toBe(0);
  f.mode = 3;
  f.intensity = 0.7;
  f.time = 9;
  expect(u.uMode).toBe(3);
  expect(u.uIntensity).toBe(0.7);
  expect(u.uTime).toBe(9);
  expect(f.mode).toBe(3);
});
