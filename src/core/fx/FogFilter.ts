import { Filter } from 'pixi.js';
import { filterProgram, FOG_FRAG } from './shaders';

interface FogUniforms {
  uTime: number;
  uDensity: number;
  uColor: Float32Array;
  uDrift: number;
  uBottom: number;
}

/**
 * Drifting fog that starts at `bottom` (uv y of the filtered area) and thickens towards its lower edge.
 * Advance `time` by dt every frame.
 */
export class FogFilter extends Filter {
  private readonly u: FogUniforms;

  constructor() {
    super({
      glProgram: filterProgram(FOG_FRAG, 'fog-filter'),
      resources: {
        fogUniforms: {
          uTime: { value: 0, type: 'f32' },
          uDensity: { value: 0.35, type: 'f32' },
          uColor: { value: new Float32Array([0.86, 0.88, 0.9]), type: 'vec3<f32>' },
          uDrift: { value: 0.03, type: 'f32' },
          uBottom: { value: 0.55, type: 'f32' },
        },
      },
    });
    this.u = this.resources.fogUniforms.uniforms;
  }

  /** Seconds; with `drift` moves the fog banks. */
  get time(): number {
    return this.u.uTime;
  }

  set time(v: number) {
    this.u.uTime = v;
  }

  /** Fog opacity at the lower edge, 0..1. */
  get density(): number {
    return this.u.uDensity;
  }

  set density(v: number) {
    this.u.uDensity = v;
  }

  /** Fog colour [r, g, b], each 0..1. */
  get color(): [number, number, number] {
    const c = this.u.uColor;
    return [c[0], c[1], c[2]];
  }

  set color(v: [number, number, number]) {
    this.u.uColor.set(v);
  }

  /** Noise offset per second (uv); 0 freezes the fog. */
  get drift(): number {
    return this.u.uDrift;
  }

  set drift(v: number) {
    this.u.uDrift = v;
  }

  /** uv y where the fog begins; below 1 (the shader's smoothstep needs bottom < 1). */
  get bottom(): number {
    return this.u.uBottom;
  }

  set bottom(v: number) {
    this.u.uBottom = Math.min(v, 0.99);
  }
}
