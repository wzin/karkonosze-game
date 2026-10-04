import { Filter } from 'pixi.js';
import { filterProgram, WEATHER_FRAG } from './shaders';

/** 0 none, 1 fog, 2 rain, 3 snow, 4 sun rays. */
export type WeatherMode = 0 | 1 | 2 | 3 | 4;

interface WeatherUniforms {
  uMode: number;
  uIntensity: number;
  uTime: number;
}

/**
 * Weather drawn over a whole scene. Fade between modes by lowering `intensity` to 0, switching
 * `mode`, then raising it again. Advance `time` by dt every frame.
 */
export class WeatherFilter extends Filter {
  private readonly u: WeatherUniforms;

  constructor() {
    super({
      glProgram: filterProgram(WEATHER_FRAG, 'weather-filter'),
      resources: {
        weatherUniforms: {
          uMode: { value: 0, type: 'i32' },
          uIntensity: { value: 0.7, type: 'f32' },
          uTime: { value: 0, type: 'f32' },
        },
      },
    });
    this.u = this.resources.weatherUniforms.uniforms;
  }

  get mode(): WeatherMode {
    return this.u.uMode as WeatherMode;
  }

  set mode(v: WeatherMode) {
    this.u.uMode = Math.min(4, Math.max(0, Math.round(v)));
  }

  /** 0 (clear) .. 1 (full weather). */
  get intensity(): number {
    return this.u.uIntensity;
  }

  set intensity(v: number) {
    this.u.uIntensity = v;
  }

  /** Seconds; moves the rain, snow, fog and rays. */
  get time(): number {
    return this.u.uTime;
  }

  set time(v: number) {
    this.u.uTime = v;
  }
}
