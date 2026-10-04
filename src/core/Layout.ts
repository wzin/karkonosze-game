/** Design space: every scene is laid out in these coordinates and scaled to fit the viewport. */
export const DESIGN = { w: 1920, h: 1080 } as const;

export interface Fit {
  scale: number;
  x: number;
  y: number;
  portrait: boolean;
}

/** Uniform "fit" scale with the design space centred (letterbox / pillarbox). */
export function fitScale(vw: number, vh: number, dw: number = DESIGN.w, dh: number = DESIGN.h): Fit {
  const scale = Math.min(vw / dw, vh / dh);
  return {
    scale,
    x: (vw - dw * scale) / 2,
    y: (vh - dh * scale) / 2,
    portrait: vh > vw,
  };
}
