import { Assets, Sprite, Texture } from 'pixi.js';

export interface GfxManifest {
  assets: Record<string, { src: string; w: number; h: number }>;
}

/** Manifest `src` paths resolve against this page-relative base (public/assets/), so any sub-path works. */
const ASSET_BASE = 'assets/';
const PLACEHOLDER_TINT = 0x8899aa;
const PLACEHOLDER_SIZE = { w: 128, h: 128 };

/**
 * Textures by alias (`<category>/<id>`) from the gfx manifest. Missing or failed assets never throw:
 * texture() hands out Texture.WHITE so scenes can draw a placeholder and keep going.
 */
export class AssetRegistry {
  private readonly groups = new Map<string, Promise<void>>();
  private readonly warned = new Set<string>();

  constructor(private readonly manifest: GfxManifest) {}

  /** Loads every alias under `<prefix>/` as the Pixi bundle `prefix`. Failed files are skipped. */
  loadGroup(prefix: string): Promise<void> {
    let pending = this.groups.get(prefix);
    if (!pending) {
      pending = this.load(prefix);
      this.groups.set(prefix, pending);
    }
    return pending;
  }

  texture(alias: string): Texture {
    const tex = this.loaded(alias);
    if (tex) return tex;
    if (!this.warned.has(alias)) {
      this.warned.add(alias);
      console.warn(`[assets] no texture "${alias}", drawing a placeholder`);
    }
    return Texture.WHITE;
  }

  /** True once the alias is loaded and drawable. */
  has(alias: string): boolean {
    return this.loaded(alias) !== null;
  }

  /** Size from the manifest, known before loading; null for an unknown alias. */
  size(alias: string): { w: number; h: number } | null {
    const entry = this.entry(alias);
    return entry ? { w: entry.w, h: entry.h } : null;
  }

  private async load(prefix: string): Promise<void> {
    const bundle = Object.entries(this.manifest.assets)
      .filter(([alias]) => alias.startsWith(`${prefix}/`))
      .map(([alias, { src }]) => ({ alias, src: ASSET_BASE + src }));
    if (bundle.length === 0) return;
    Assets.addBundle(prefix, bundle);
    try {
      // 'skip' keeps one broken file from failing the whole group; it falls back to a placeholder
      await Assets.load(
        bundle.map((a) => a.alias),
        {
          strategy: 'skip',
          onError: (err, asset) =>
            console.warn(`[assets] failed to load ${typeof asset === 'string' ? asset : String(asset.src)}`, err),
        },
      );
    } catch (err) {
      console.warn(`[assets] group "${prefix}" failed to load`, err);
    }
  }

  private loaded(alias: string): Texture | null {
    if (!this.entry(alias) || !Assets.cache.has(alias)) return null;
    const tex: unknown = Assets.cache.get(alias);
    return tex instanceof Texture ? tex : null;
  }

  private entry(alias: string) {
    return Object.hasOwn(this.manifest.assets, alias) ? this.manifest.assets[alias] : undefined;
  }
}

/** Sprite for `alias`; when it is missing, a tinted WHITE sprite of the fallback (or manifest) size. */
export function sprite(reg: AssetRegistry, alias: string, fallback?: { w: number; h: number; tint?: number }): Sprite {
  if (reg.has(alias)) return new Sprite(reg.texture(alias));
  const placeholder = new Sprite(reg.texture(alias));
  const size = fallback ?? reg.size(alias) ?? PLACEHOLDER_SIZE;
  placeholder.width = size.w;
  placeholder.height = size.h;
  placeholder.tint = fallback?.tint ?? PLACEHOLDER_TINT;
  return placeholder;
}
