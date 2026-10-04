import './style.css';
import { Application, Assets, Container } from 'pixi.js';
import content from './content/pl.json';
import { AssetRegistry, type GfxManifest } from './core/Assets';
import { Audio } from './core/Audio';
import { I18n } from './core/I18n';
import { IdleTimer } from './core/Kiosk';
import { DESIGN, fitScale } from './core/Layout';
import { parseRoute, routeTarget } from './core/Router';
import { Save } from './core/Save';
import type { SceneContext } from './core/Scene';
import { SceneManager } from './core/SceneManager';
import { GAMES } from './games';
import glassText from './games/glass/pl.json';
import herbsText from './games/herbs/pl.json';
import mineText from './games/mine/pl.json';
import turnipsText from './games/turnips/pl.json';
import PanoramaScene from './hub/PanoramaScene';

interface AudioManifest {
  clips: Record<string, { src: string; seconds: number; loop: boolean }>;
}

const AUDIO_BASE = 'assets/audio/';
const IDLE_SECONDS = 60;
/** Below this on-screen width (CSS px) the fitted scene is too small: ask to rotate the device. */
const MIN_SCENE_WIDTH = 700;

/** @fontsource subsets copied by tools/fonts.sh: "latin" has ASCII, "latin-ext" has the Polish diacritics. */
const FONT_SUBSETS: Record<string, string> = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  'latin-ext':
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};
const FONTS = [
  { family: 'Fraunces', file: 'fraunces', weights: ['500', '700', '900'] },
  { family: 'Nunito', file: 'nunito', weights: ['400', '600', '700', '800'] },
];

async function main(): Promise<void> {
  const i18n = new I18n(content, glassText, turnipsText, mineText, herbsText);
  document.title = i18n.t('app.title');
  element('rotate').textContent = i18n.t('ui.rotate');

  if (!document.createElement('canvas').getContext('webgl2')) {
    const message = element('nowebgl');
    message.textContent = i18n.t('ui.noWebgl');
    message.hidden = false;
    return;
  }

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#141a26',
    antialias: true,
    resolution: Math.min(devicePixelRatio, 2),
    autoDensity: true,
  });
  element('app').appendChild(app.canvas);

  const [, gfx, sounds] = await Promise.all([
    loadFonts(),
    fetchJson<GfxManifest>('assets/gfx/manifest.json'),
    fetchJson<AudioManifest>('assets/audio/manifest.json'),
  ]);

  const places = i18n.get<{ id: string }[]>('places');
  const route = parseRoute(location.hash, location.search, places.map((p) => p.id));

  const root = new Container();
  app.stage.addChild(root);
  const fit = () => fitToWindow(root);
  window.addEventListener('resize', fit);
  fit();

  const idle = new IdleTimer(IDLE_SECONDS, () => ctx.go('hub'));
  const scenes = new SceneManager(root, app.ticker, () => idle.touch());
  const ctx: SceneContext = {
    app,
    i18n,
    kiosk: route.kiosk,
    assets: new AssetRegistry(gfx ?? { assets: {} }),
    audio: new Audio({}, AUDIO_BASE, new Set(Object.keys(sounds?.clips ?? {}))),
    save: new Save(),
    go(sceneId, params) {
      if (route.kiosk && sceneId !== 'hub') idle.start();
      else idle.stop();
      scenes.go(sceneId, params).catch((err: unknown) => {
        console.error(err);
        if (sceneId !== 'hub') ctx.go('hub');
      });
    },
  };
  scenes.setContext(ctx);
  scenes.register('hub', (c) => new PanoramaScene(c));
  for (const game of GAMES) {
    scenes.register(`game:${game.id}`, async (c) => new (await game.load()).default(c));
  }

  const start = routeTarget(route, GAMES);
  ctx.go(start.sceneId, start.params);
}

function fitToWindow(root: Container): void {
  const f = fitScale(window.innerWidth, window.innerHeight);
  root.scale.set(f.scale);
  root.position.set(f.x, f.y);
  document.body.classList.toggle('portrait', f.portrait && f.scale * DESIGN.w < MIN_SCENE_WIDTH);
}

async function loadFonts(): Promise<void> {
  const faces = FONTS.flatMap(({ family, file, weights }) =>
    weights.flatMap((weight) =>
      Object.entries(FONT_SUBSETS).map(([subset, unicodeRange]) => ({
        alias: `${file}-${subset}-${weight}`,
        src: `fonts/${file}-${subset}-${weight}-normal.woff2`,
        data: { family, weights: [weight], unicodeRange },
      })),
    ),
  );
  const results = await Promise.allSettled(faces.map((face) => Assets.load(face)));
  for (const r of results) if (r.status === 'rejected') console.warn('[fonts]', r.reason);
}

/** Parsed JSON, or null when the file is missing or broken (assets not generated yet). */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from index.html`);
  return el;
}

main().catch((err: unknown) => console.error(err));
