import { Filter } from 'pixi.js';
import { filterProgram, LAMP_LIGHT_FRAG } from './shaders';

interface LampLightUniforms {
  uLight: Float32Array;
  uRadius: number;
  uAmbient: number;
  uFlicker: number;
  uTime: number;
}

/**
 * Darkens everything except a warm circle of lamp light at `light` (uv of the filtered area). The
 * circle stays round on wide areas: `radius` is measured in heights of the area. Advance `time` by dt
 * every frame for the flicker.
 */
export class LampLightFilter extends Filter {
  private readonly u: LampLightUniforms;

  constructor() {
    super({
      glProgram: filterProgram(LAMP_LIGHT_FRAG, 'lamp-light-filter'),
      resources: {
        lampLightUniforms: {
          uLight: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
          uRadius: { value: 0.25, type: 'f32' },
          uAmbient: { value: 0.06, type: 'f32' },
          uFlicker: { value: 0.15, type: 'f32' },
          uTime: { value: 0, type: 'f32' },
        },
      },
    });
    this.u = this.resources.lampLightUniforms.uniforms;
  }

  /** Lamp centre [x, y] in uv of the filtered area. */
  get light(): [number, number] {
    const l = this.u.uLight;
    return [l[0], l[1]];
  }

  set light(v: [number, number]) {
    this.u.uLight.set(v);
  }

  /** Where the light fades out, in heights of the filtered area. */
  get radius(): number {
    return this.u.uRadius;
  }

  set radius(v: number) {
    this.u.uRadius = Math.max(v, 1e-4);
  }

  /** Brightness outside the light, 0 (black) .. 1 (unlit). */
  get ambient(): number {
    return this.u.uAmbient;
  }

  set ambient(v: number) {
    this.u.uAmbient = v;
  }

  /** How much the flame flickers, 0 .. 1. */
  get flicker(): number {
    return this.u.uFlicker;
  }

  set flicker(v: number) {
    this.u.uFlicker = v;
  }

  /** Seconds; drives the flicker. */
  get time(): number {
    return this.u.uTime;
  }

  set time(v: number) {
    this.u.uTime = v;
  }
}
