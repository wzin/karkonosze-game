import { GlProgram } from 'pixi.js';

/** Pixi's standard filter vertex shader: covers the filtered area, hands the fragment `vTextureCoord`. */
export const FILTER_VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  p.x = p.x * (2.0 / uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(p, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) { gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;

/**
 * Start of every fragment. Pixi compiles a filter as GLSL 300 es only when the fragment carries the
 * `#version 300 es` line (it strips it, adds precision, then puts it back on top); without it the
 * source would go through Pixi's GLSL 1.00 compatibility macros instead.
 *
 * `vTextureCoord` spans only the used part of a pooled (power-of-two) texture, so `areaUv()` maps it
 * to 0..1 across the filtered area and `textureUv()` maps such a uv back for sampling, clamped to the
 * input. The `uv` parameters of every filter (rect, light, bottom…) are in that 0..1 area space.
 */
const HEADER = `#version 300 es
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;

vec2 areaUv() { return vTextureCoord * uInputSize.xy / uOutputFrame.zw; }
vec2 textureUv(vec2 uv) { return clamp(uv * uOutputFrame.zw * uInputSize.zw, uInputClamp.xy, uInputClamp.zw); }
float areaAspect() { return uOutputFrame.z / uOutputFrame.w; }
`;

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return v;
}
`;

/** Fog that thickens from `bottom` (area uv y) down to the bottom edge, broken up by drifting fbm. */
const FOG_AMOUNT = `
float fogAmount(vec2 uv, float density, float bottom, float drift, float time) {
  return clamp(density * smoothstep(bottom, 1.0, uv.y) * (0.6 + 0.4 * fbm(uv * 3.0 + time * drift)), 0.0, 1.0);
}
`;

/** Shimmering air over the furnace mouth (`uRect` = x, y, w, h in area uv) with a pulsing ember tint. */
export const HEAT_HAZE_FRAG = `${HEADER}
uniform float uTime;
uniform float uIntensity;
uniform vec4 uRect;
${NOISE}
void main() {
  vec2 uv = areaUv();
  vec2 d = (uv - uRect.xy) / uRect.zw;
  float inside = step(0.0, d.x) * step(d.x, 1.0) * step(0.0, d.y) * step(d.y, 1.0);
  float fall = inside * (1.0 - smoothstep(0.4, 1.0, length(d - 0.5) * 2.0));
  // the noise scrolls up the screen: hot air rises
  float n = noise(vec2(uv.x * 40.0, uv.y * 30.0 + uTime * 2.5)) - 0.5;
  uv.x += n * 0.012 * uIntensity * fall;
  uv.y += (noise(vec2(uv.x * 30.0 + 9.0, uv.y * 40.0 + uTime * 3.0)) - 0.5) * 0.008 * uIntensity * fall;
  vec4 c = texture(uTexture, textureUv(uv));
  // premultiplied alpha: the glow is scaled by c.a so transparent pixels stay transparent
  c.rgb += vec3(0.25, 0.12, 0.0) * fall * uIntensity * (0.6 + 0.4 * sin(uTime * 7.0)) * c.a;
  finalColor = c;
}`;

/** Valley fog: `uColor` mixed in below `uBottom`, drifting with `uTime * uDrift`. */
export const FOG_FRAG = `${HEADER}
uniform float uTime;
uniform float uDensity;
uniform vec3 uColor;
uniform float uDrift;
uniform float uBottom;
${NOISE}
${FOG_AMOUNT}
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  float fog = fogAmount(areaUv(), uDensity, uBottom, uDrift, uTime);
  finalColor = mix(c, vec4(uColor, 1.0) * c.a, fog);
}`;

/** Darkness with one warm, flickering lamp at `uLight`; `uRadius` is measured in area heights. */
export const LAMP_LIGHT_FRAG = `${HEADER}
uniform vec2 uLight;
uniform float uRadius;
uniform float uAmbient;
uniform float uFlicker;
uniform float uTime;
void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 aspect = vec2(areaAspect(), 1.0);
  float d = distance(areaUv() * aspect, uLight * aspect);
  float l = 1.0 - smoothstep(uRadius * 0.15, uRadius, d);
  l *= 1.0 - uFlicker * 0.5 * (0.5 + 0.5 * sin(uTime * 23.0) * sin(uTime * 7.3));
  vec3 warm = vec3(1.0, 0.86, 0.62);
  finalColor = vec4(c.rgb * (uAmbient + l * warm), c.a);
}`;

/** Weather over a whole scene: `uMode` 0 none, 1 fog, 2 rain, 3 snow, 4 sun rays; scaled by `uIntensity`. */
export const WEATHER_FRAG = `${HEADER}
uniform int uMode;
uniform float uIntensity;
uniform float uTime;
${NOISE}
${FOG_AMOUNT}
// slanted streaks in columns; each column runs on its own phase and the streaks fall down the screen
float rainLayer(vec2 uv, float cols, float speed, float seed) {
  vec2 p = vec2(uv.x + uv.y * 0.12, uv.y);
  float col = floor(p.x * cols);
  float y = (p.y - uTime * speed) * 10.0 + hash(vec2(col, seed)) * 10.0;
  float on = step(0.985, hash(vec2(col + seed, floor(y))));
  float thin = 1.0 - smoothstep(0.08, 0.22, abs(fract(p.x * cols) - 0.5));
  return on * thin * fract(y);
}
// one flake per lit cell, swaying sideways as it falls
float snowLayer(vec2 uv, float scale, float speed, float seed) {
  vec2 p = vec2(uv.x * areaAspect(), uv.y) * scale;
  p.y -= uTime * speed;
  p.x += sin(p.y * 0.9 + seed) * 0.35 + sin(uTime * 0.7 + seed) * 0.2;
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = hash(cell + seed);
  vec2 off = vec2(hash(cell + seed + 3.1), hash(cell + seed + 7.7)) - 0.5;
  float r = 0.07 + 0.08 * h;
  return (1.0 - smoothstep(r * 0.35, r, length(f - off * 0.5))) * step(0.4, h);
}
// god rays fanning out from above the top-left corner
vec3 sunRays(vec2 uv) {
  vec2 a = vec2(areaAspect(), 1.0);
  vec2 dir = (uv - vec2(-0.15, -0.25)) * a;
  float dist = length(dir);
  vec2 n = dir / dist;
  float rays = smoothstep(0.35, 0.75, fbm(vec2(atan(n.y, n.x) * 9.0, uTime * 0.12)));
  float along = max(dot(n, normalize(vec2(1.0, 0.8))), 0.0);
  return vec3(1.0, 0.85, 0.55) * (0.25 + 0.75 * rays) * along * exp(-dist * 0.9);
}
void main() {
  vec2 uv = areaUv();
  vec4 c = texture(uTexture, vTextureCoord);
  if (uMode == 1) {
    float fog = fogAmount(uv, uIntensity, -0.6, 0.04, uTime);
    c = mix(c, vec4(0.86, 0.88, 0.9, 1.0) * c.a, fog);
  } else if (uMode == 2) {
    float r = rainLayer(uv, 220.0, 1.6, 0.0) + 0.6 * rainLayer(uv, 140.0, 1.1, 7.0);
    c.rgb = c.rgb * (1.0 - 0.25 * uIntensity) + vec3(0.85, 0.9, 1.0) * r * 0.6 * uIntensity * c.a;
  } else if (uMode == 3) {
    float s = clamp(snowLayer(uv, 9.0, 0.9, 0.0) + 0.7 * snowLayer(uv, 16.0, 1.0, 13.0), 0.0, 1.0);
    c.rgb = mix(c.rgb, c.rgb * vec3(0.92, 0.96, 1.05), 0.4 * uIntensity);
    c.rgb = mix(c.rgb, vec3(c.a), s * uIntensity);
  } else if (uMode == 4) {
    c.rgb = mix(c.rgb, c.rgb * vec3(1.08, 1.0, 0.88), 0.5 * uIntensity);
    c.rgb += sunRays(uv) * 0.7 * uIntensity * c.a;
  }
  finalColor = c;
}`;

/** GL program for one of the fragments above; highp where the GPU has it, so the hash noise stays smooth. */
export function filterProgram(fragment: string, name: string): GlProgram {
  return GlProgram.from({ vertex: FILTER_VERTEX, fragment, name, preferredFragmentPrecision: 'highp' });
}
