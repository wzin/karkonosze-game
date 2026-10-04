import { Container, Graphics, Sprite } from 'pixi.js';
import { sprite, type AssetRegistry } from '../../core/Assets';
import { Theme } from '../../ui/Theme';

/**
 * A cut-out landscape band scrolled to the left forever. Two copies side by side, the second mirrored
 * (`scale.x = -1`), so each seam joins an edge with its own mirror image and never shows a step.
 * The pair repeats every two band widths; a copy that leaves on the left jumps two widths to the right.
 */
export class MirrorBand extends Container {
  private readonly tiles: Sprite[];
  private readonly tileW: number;
  private offset = 0;

  /** `scale` enlarges the band; scroll() still moves it in screen px. */
  constructor(assets: AssetRegistry, alias: string, fallback: { w: number; h: number; tint: number }, scale = 1) {
    super();
    const plain = sprite(assets, alias, fallback);
    const mirrored = sprite(assets, alias, fallback);
    plain.scale.set(plain.scale.x * scale, plain.scale.y * scale);
    mirrored.scale.set(-mirrored.scale.x * scale, mirrored.scale.y * scale);
    this.tileW = plain.width;
    this.tiles = [plain, mirrored];
    this.addChild(plain, mirrored);
    this.place();
  }

  get bandHeight(): number {
    return this.tiles[0].height;
  }

  scroll(px: number): void {
    this.offset = (this.offset + px) % (this.tileW * 2);
    this.place();
  }

  private place(): void {
    const w = this.tileW;
    // left edge of each copy; a mirrored sprite extends to the left of its x
    let a = -this.offset;
    let b = w - this.offset;
    if (a + w <= 0) a += 2 * w;
    if (b + w <= 0) b += 2 * w;
    this.tiles[0].x = a;
    this.tiles[1].x = b + w;
  }
}

/** Scales `s` (anchored by the caller) to fit inside w×h. */
export function fit(s: Sprite, w: number, h: number): Sprite {
  const k = Math.min(w / s.texture.width, h / s.texture.height);
  s.scale.set(k * Math.sign(s.scale.x || 1), k);
  return s;
}

/** Round green badge with a white tick, centred on (0, 0). */
export function tickBadge(r = 22): Graphics {
  return new Graphics()
    .circle(0, 2, r)
    .fill({ color: Theme.color.night, alpha: 0.35 })
    .circle(0, 0, r)
    .fill(Theme.color.glass)
    .stroke({ color: Theme.color.paper, width: 3 })
    .moveTo(-r * 0.45, 0)
    .lineTo(-r * 0.1, r * 0.35)
    .lineTo(r * 0.5, -r * 0.35)
    .stroke({ color: Theme.color.paper, width: r * 0.22, cap: 'round', join: 'round' });
}

/** Dark rounded panel with the UI kit's ember edge and drop shadow, from (0, 0). */
export function panel(w: number, h: number, alpha = 0.82): Graphics {
  return new Graphics()
    .roundRect(0, 6, w, h, 24)
    .fill({ color: Theme.color.night, alpha: 0.35 })
    .roundRect(0, 0, w, h, 24)
    .fill({ color: Theme.color.night, alpha })
    .stroke({ color: Theme.color.ember, alpha: 0.6, width: 2 });
}
