import { Filter, type FilterSystem, type RenderSurface, type Texture } from 'pixi.js';
import { AERIAL_FRAG, filterProgram } from './shaders';

interface AerialUniforms {
  uWidth: number;
  uDarken: number;
  uHaze: number;
  uHazeColor: Float32Array;
}

/**
 * Sets a cut-out layer back into the distance. Its edge is feathered by about `width` px: the
 * outermost pixel row fades out and the next one softens, so a thin pale fringe left by the cut-out
 * (a light rim on a skyline) disappears, and what remains of the edge darkens by up to `darken`. Then
 * a `haze` share of `hazeColor` veils the whole layer, lifting its darks and lowering its contrast.
 * Solid areas keep their alpha.
 *
 * It renders at the renderer's resolution (`'inherit'`), so a ridge on a DPR 2 screen is not drawn
 * into a half-resolution texture and upscaled; `width` is in logical px and becomes that many times
 * the input's resolution in input pixels when the filter runs, so the edge looks the same everywhere.
 */
export class AerialFilter extends Filter {
  private readonly u: AerialUniforms;
  private featherWidth = 1;

  constructor() {
    super({
      glProgram: filterProgram(AERIAL_FRAG, 'aerial-filter'),
      resources: {
        aerialUniforms: {
          uWidth: { value: 1, type: 'f32' },
          uDarken: { value: 0.3, type: 'f32' },
          uHaze: { value: 0, type: 'f32' },
          uHazeColor: { value: new Float32Array([0.5, 0.5, 0.6]), type: 'vec3<f32>' },
        },
      },
      resolution: 'inherit',
    });
    this.u = this.resources.aerialUniforms.uniforms;
  }

  /** Feather ring radius in logical px; each run scales it by the input's resolution. */
  get width(): number {
    return this.featherWidth;
  }

  set width(v: number) {
    this.featherWidth = Math.max(0, v);
    this.u.uWidth = this.featherWidth;
  }

  /** How much darker the feathered edge gets, 0..1. */
  get darken(): number {
    return this.u.uDarken;
  }

  set darken(v: number) {
    this.u.uDarken = clamp01(v);
  }

  /** Share of the haze colour mixed into every pixel, 0..1. */
  get haze(): number {
    return this.u.uHaze;
  }

  set haze(v: number) {
    this.u.uHaze = clamp01(v);
  }

  /** Haze colour [r, g, b], each clamped to 0..1. */
  get hazeColor(): [number, number, number] {
    const c = this.u.uHazeColor;
    return [c[0], c[1], c[2]];
  }

  set hazeColor(v: [number, number, number]) {
    this.u.uHazeColor.set(v.map(clamp01));
  }

  /** The ring radius in input pixels: `width` logical px at the resolution the input was rendered at. */
  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    this.u.uWidth = this.featherWidth * input.source.resolution;
    super.apply(filterManager, input, output, clearMode);
  }
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}
