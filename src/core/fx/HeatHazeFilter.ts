import { Filter } from 'pixi.js';
import { filterProgram, HEAT_HAZE_FRAG } from './shaders';

interface HeatHazeUniforms {
  uTime: number;
  uIntensity: number;
  uRect: Float32Array;
}

/**
 * Shimmering hot air with an ember glow inside `rect` (the furnace mouth, as x, y, w, h in 0..1 uv of
 * the filtered area), strongest in its middle. Advance `time` by dt every frame.
 */
export class HeatHazeFilter extends Filter {
  private readonly u: HeatHazeUniforms;

  constructor() {
    super({
      glProgram: filterProgram(HEAT_HAZE_FRAG, 'heat-haze-filter'),
      resources: {
        heatHazeUniforms: {
          uTime: { value: 0, type: 'f32' },
          uIntensity: { value: 1, type: 'f32' },
          uRect: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
        },
      },
    });
    this.u = this.resources.heatHazeUniforms.uniforms;
  }

  /** Seconds; drives the shimmer and the glow pulse. */
  get time(): number {
    return this.u.uTime;
  }

  set time(v: number) {
    this.u.uTime = v;
  }

  /** 0 (still air) .. 1 (full shimmer and glow). */
  get intensity(): number {
    return this.u.uIntensity;
  }

  set intensity(v: number) {
    this.u.uIntensity = Math.min(1, Math.max(0, v));
  }

  /** Furnace mouth [x, y, w, h] in uv of the filtered area. */
  get rect(): [number, number, number, number] {
    const r = this.u.uRect;
    return [r[0], r[1], r[2], r[3]];
  }

  set rect(v: [number, number, number, number]) {
    // a zero-sized rect would divide by zero in the shader
    this.u.uRect.set([v[0], v[1], Math.max(v[2], 1e-4), Math.max(v[3], 1e-4)]);
  }
}
