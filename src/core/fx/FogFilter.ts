import { Filter } from 'pixi.js';
import { filterProgram, FOG_FRAG } from './shaders';

interface FogUniforms {
  uTime: number;
  uDensity: number;
  uColor: Float32Array;
  uDrift: number;
  uBottom: number;
  uEnd: number;
}

/**
 * Drifting fog that starts at `bottom` (uv y of the filtered area) and thickens to `density` at `end`
 * (by default the area's lower edge), staying that thick below it. Advance `time` by dt every frame.
 */
export class FogFilter extends Filter {
  private readonly u: FogUniforms;
  /** `end` as last set; the uniform may sit higher while `bottom` is above it. */
  private wantedEnd = 1;

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
          uEnd: { value: 1, type: 'f32' },
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

  /** Fog opacity from `end` down, 0..1. */
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

  /** uv y where the fog begins; below 1 (the shader's smoothstep needs bottom < end ≤ 1). */
  get bottom(): number {
    return this.u.uBottom;
  }

  set bottom(v: number) {
    this.u.uBottom = Math.min(v, 0.99);
    this.syncEnd();
  }

  /**
   * uv y where the fog reaches full `density`: 1 (the lower edge) by default. The shader gets at least
   * `bottom` + 0.01, whichever is set first; the value asked for comes back once `bottom` allows it.
   */
  get end(): number {
    return this.u.uEnd;
  }

  set end(v: number) {
    this.wantedEnd = Math.min(v, 1);
    this.syncEnd();
  }

  private syncEnd(): void {
    this.u.uEnd = Math.min(Math.max(this.wantedEnd, this.u.uBottom + 0.01), 1);
  }
}
