import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { Theme } from './Theme';

const RING = 7;

/**
 * Round character portrait with a paper-and-ember ring, centred on (0, 0). The texture is cropped to
 * the circle ("cover"); a missing one (Texture.WHITE) shows a dusk silhouette instead.
 */
export class Portrait extends Container {
  constructor(tex: Texture, diameter = 160) {
    super();
    const r = diameter / 2;
    const shadow = new Graphics().circle(0, 6, r + RING).fill({ color: Theme.color.night, alpha: 0.35 });
    const ring = new Graphics()
      .circle(0, 0, r + RING)
      .fill(Theme.color.paper)
      .circle(0, 0, r + 3)
      .fill(Theme.color.ember);

    const mask = new Graphics().circle(0, 0, r).fill(0xffffff);
    const content = new Container();
    content.mask = mask;
    if (tex === Texture.WHITE) {
      content.addChild(silhouette(r));
    } else {
      const photo = new Sprite(tex);
      photo.anchor.set(0.5);
      photo.scale.set(diameter / Math.max(Math.min(tex.width, tex.height), 1));
      content.addChild(photo);
    }
    this.addChild(shadow, ring, content, mask);
  }
}

function silhouette(r: number): Graphics {
  return new Graphics()
    .circle(0, 0, r)
    .fill(Theme.color.dusk)
    .circle(0, -r * 0.18, r * 0.34)
    .fill({ color: Theme.color.night, alpha: 0.55 })
    .ellipse(0, r * 0.72, r * 0.62, r * 0.48)
    .fill({ color: Theme.color.night, alpha: 0.55 });
}
