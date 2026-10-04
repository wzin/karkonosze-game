# Baśnie Karkonoszy — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zbudować stronę www z panoramą Karkonoszy (hub) i czterema grywalnymi mini grami (Hutnik, Liczyrzepa, Sztolnia, Laborant) z grafiką i dźwiękiem generowanymi przez fal.ai oraz shaderami, działającą też jako kiosk i jako pojedyncza gra z QR.

**Architecture:** Jedna aplikacja PixiJS 8 (Vite + TypeScript) z menedżerem scen; hub i każda gra to osobna scena w osobnym katalogu, które znają tylko wspólne `core/` i `ui/`. Assety powstają poza runtime'em: pipeline w Pythonie (`tools/assets/`) generuje obrazy i dźwięki przez fal.ai, wycina tła, zapisuje WebP/MP3 do `public/assets/` i rejestr `manifest.json`; wyniki są commitowane. Efekty (żar, mgła, światło lampy, pogoda) to filtry GLSL w `core/fx/`.

**Tech Stack:** pnpm, Vite 8, TypeScript 7, pixi.js 8.22, pixi-filters 6.1, howler 2.2, vitest 5, @playwright/test 1.63; Python 3.12 + uv, fal-client, pillow, pyyaml, imageio-ffmpeg (statyczny ffmpeg).

**Spec:** `docs/superpowers/specs/2026-10-04-karkonosze-games-design.md`

## Global Constraints

- Przestrzeń projektowa **1920×1080**, skalowanie „fit” z letterboxem; w portrecie podpowiedź obrotu (DOM overlay).
- Teksty **tylko w JSON** (`src/content/pl.json` + `src/games/<gra>/pl.json`), żadnych polskich stringów w kodzie TS poza testami.
- Każda gra: intro (1 ekran) → 3–5 rund → podsumowanie; „Czy wiesz, że” po każdej rundzie; gwiazdki 1–3; sterowanie jednym palcem (pointer events, nie mouse/touch osobno).
- Czas gry 1–3 min. Każda runda ma limit, po którym gra idzie dalej sama.
- Kiosk (`?kiosk=1`): hit-boxy ≥ 96 px, brak linków zewnętrznych, po 60 s bezczynności poza hubem powrót do hubu.
- Routing: `#gra=<place-id>` otwiera grę bez hubu; place-id to id z `pl.json` (`szklarska`, `sniezka`, `kowary`, `karpacz`).
- Żaden moduł `games/<a>` nie importuje `games/<b>`. Gry importują tylko `core/*`, `ui/*`, własny katalog.
- Grafika: brak wypalonych efektów ognia/poświaty w promptach (test w pipeline), brak tekstu na obrazach, brak realnych twarzy. Styl: wycinanka + gwasz, zmierzchowa paleta (hub, Hutnik, Liczyrzepa), ciemna (Sztolnia), poranna (Laborant).
- Każda generacja fal.ai zapisana w `tools/assets/raw/manifest.lock.json` (model, prompt, seed, url). `raw/` jest w `.gitignore`, `public/assets/**` jest commitowane.
- Budżet: ≤ 40 MB WebP, ≤ 10 MB audio.
- Klucz fal: `FAL_KEY` ze środowiska albo linia `fal: <klucz>` w `~/.api_keys` (`tools/assets/falkey.py`).
- Commity: polskie lub angielskie, krótkie, z trailerami `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` i `Claude-Session: https://claude.ai/code/session_01HuV5fNZFNQtjTVcQQqPfao`.
- Zrzuty ekranu do gitignorowanego `docs/screenshots/`.

## Review Focus

1. **Brak assetu lub błąd 404** (np. gra uruchomiona zanim pipeline wygenerował obraz): scena musi narysować placeholder `Graphics` i działać; test w Task 1 (`AssetRegistry.texture()` zwraca `Texture.WHITE` + loguje raz).
2. **Dotyk na kiosku: pointerup poza przyciskiem po przytrzymaniu** (palec zjeżdża z „Dmuchaj”): hold musi się zakończyć (pointercapture + `pointercancel`/`pointerleave`), bańka nie rośnie w nieskończoność; test logiki w Task 7 (`blowScore` przy przekroczeniu → pęknięcie) + smoke w Task 12.
3. **localStorage niedostępny** (tryb prywatny, kiosk z czyszczeniem): `Save` łapie wyjątki i działa w pamięci; test w Task 1.
4. **Hash z nieznanym id** (`#gra=xyz`, literówka w QR): router wraca do hubu, nie do pustego ekranu; test w Task 1.
5. **Portret / bardzo wąski ekran** (telefon): skala fit daje scenę < 600 px szerokości; overlay „obróć telefon”; przyciski nadal ≥ 44 px CSS; test `fitScale` w Task 1 + smoke w Task 12 przy 390×844.

---

## Struktura plików

```
karkonosze-game/
  package.json  pnpm-lock.yaml  tsconfig.json  vite.config.ts  vitest.config.ts  index.html  .gitignore
  public/
    fonts/            Fraunces-*.woff2, Nunito-*.woff2 (z @fontsource, kopiowane skryptem)
    assets/gfx/<kategoria>/<id>.webp   assets/gfx/manifest.json
    assets/audio/<kategoria>/<id>.mp3  assets/audio/manifest.json
  src/
    main.ts                       bootstrap: Application, Layout, Router, SceneManager, kiosk
    style.css                     tło letterboxu, overlay obrotu, fallback bez WebGL
    core/
      Scene.ts                    abstract Scene + SceneContext
      SceneManager.ts             rejestr scen, go(), ticker → update(dt)
      Layout.ts                   DESIGN, fitScale()
      Router.ts                   parseRoute()
      Save.ts                     Save (localStorage, in-memory fallback)
      I18n.ts                     t(), merge słowników
      Audio.ts                    Howler + tabela momentów, play(moment)
      Assets.ts                   AssetRegistry: manifest.json → Pixi Assets bundles, texture(alias)
      Kiosk.ts                    IdleTimer
      Rng.ts                      mulberry32 (powtarzalne testy)
      fx/HeatHazeFilter.ts  fx/FogFilter.ts  fx/LampLightFilter.ts  fx/WeatherFilter.ts  fx/shaders.ts
    ui/
      Button.ts  HoldButton.ts  SpeechBubble.ts  Stars.ts  FactCard.ts  RoundProgress.ts
      TopBar.ts  Portrait.ts  Theme.ts (kolory, fonty, rozmiary)  Loader.ts
    hub/
      PanoramaScene.ts  Markers.ts  ConceptCard.ts  Parallax.ts
    games/
      index.ts                    rejestr: id, placeId, loader sceny
      glass/   GlassScene.ts  rules.ts  rules.test.ts  pl.json  steps/Heat.ts Blow.ts Color.ts Shape.ts Result.ts
      turnips/ TurnipsScene.ts rules.ts rules.test.ts pl.json
      mine/    MineScene.ts    rules.ts rules.test.ts pl.json
      herbs/   HerbsScene.ts   rules.ts rules.test.ts pl.json
    content/pl.json               app, ui, places[17], facts
  tools/
    assets/
      .venv/  falkey.py  manifest.yaml  audio_manifest.yaml  generate.py  cutout.py  pack.py  audio.py
      test_manifest.py  raw/ (gitignored)  raw/manifest.lock.json (tracked)
    fonts.sh
    smoke/  smoke.spec.ts  playwright.config.ts
  docs/superpowers/specs|plans   docs/screenshots/ (gitignored)
```

## Ściąga PixiJS 8 (dla wykonawców)

```ts
import { Application, Assets, Container, Sprite, Graphics, Text, TextStyle, Texture, Filter, GlProgram, Ticker } from 'pixi.js';
const app = new Application(); await app.init({ resizeTo: window, background: '#141a26', antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
document.getElementById('app')!.appendChild(app.canvas);
// Graphics: najpierw kształt, potem fill/stroke
const g = new Graphics().roundRect(0, 0, 300, 90, 24).fill({ color: 0xdd8a2c }).stroke({ color: 0xffffff, width: 3, alpha: .4 });
// Assets: bundle + alias
Assets.addBundle('hub', [{ alias: 'hub/sky', src: '/assets/gfx/hub/sky.webp' }]); await Assets.loadBundle('hub'); const s = Sprite.from('hub/sky');
// Fonty
await Assets.load({ alias: 'Fraunces', src: '/fonts/fraunces-latin-ext-700-normal.woff2', data: { family: 'Fraunces' } });
// Eventy
s.eventMode = 'static'; s.cursor = 'pointer'; s.on('pointerdown', e => {}); s.on('pointerup', ...); s.on('pointerupoutside', ...);
// Filtr GLSL (300 es; Pixi dodaje #version i precision)
const vertex = `in vec2 aPosition; out vec2 vTextureCoord; uniform vec4 uInputSize; uniform vec4 uOutputFrame; uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void){ vec2 p = aPosition * uOutputFrame.zw + uOutputFrame.xy; p.x = p.x*(2.0/uOutputTexture.x)-1.0; p.y = p.y*(2.0*uOutputTexture.z/uOutputTexture.y)-uOutputTexture.z; return vec4(p,0.0,1.0);}
vec2 filterTextureCoord(void){ return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void){ gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;
const fragment = `in vec2 vTextureCoord; out vec4 finalColor; uniform sampler2D uTexture; uniform float uTime;
void main(void){ finalColor = texture(uTexture, vTextureCoord); }`;
const f = new Filter({ glProgram: GlProgram.from({ vertex, fragment }), resources: { u: { uTime: { value: 0, type: 'f32' } } } });
f.resources.u.uniforms.uTime = 1.5; container.filters = [f];
// Ticker: dt w sekundach
app.ticker.add(t => update(t.deltaMS / 1000));
```

---

## Fala 1 (równolegle, osobne worktree): Task 1, Task 2, Task 3

### Task 1: Szkielet aplikacji i `core/`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `src/main.ts`, `src/style.css`, `src/vite-env.d.ts`
- Create: `src/core/Scene.ts`, `src/core/SceneManager.ts`, `src/core/Layout.ts`, `src/core/Router.ts`, `src/core/Save.ts`, `src/core/I18n.ts`, `src/core/Audio.ts`, `src/core/Assets.ts`, `src/core/Kiosk.ts`, `src/core/Rng.ts`
- Create: `src/content/pl.json`, `src/games/index.ts` (+ 4 stuby scen), `src/hub/PanoramaScene.ts` (stub: tło + napis), `tools/fonts.sh`
- Test: `src/core/Layout.test.ts`, `src/core/Router.test.ts`, `src/core/Save.test.ts`, `src/core/I18n.test.ts`, `src/core/Rng.test.ts`, `src/core/Assets.test.ts`

**Interfaces (Produces):**

```ts
// src/core/Layout.ts
export const DESIGN = { w: 1920, h: 1080 } as const;
export interface Fit { scale: number; x: number; y: number; portrait: boolean }
export function fitScale(vw: number, vh: number, dw = DESIGN.w, dh = DESIGN.h): Fit;
// scale = min(vw/dw, vh/dh); x = (vw - dw*scale)/2; y = (vh - dh*scale)/2; portrait = vh > vw

// src/core/Router.ts
export interface Route { game: string | null; kiosk: boolean }
export function parseRoute(hash: string, search: string, knownPlaces: string[]): Route;
// '#gra=kowary' → {game:'kowary'}; nieznane → game:null; '?kiosk=1' → kiosk:true

// src/core/Save.ts
export interface GameRecord { stars: number; playedAt: string; field?: boolean }
export interface SaveData { version: 1; games: Record<string, GameRecord> }
export class Save {
  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'> | null); // null → in-memory
  load(): SaveData;
  record(gameId: string, stars: number, field?: boolean): SaveData; // max(stars), playedAt=now ISO
}

// src/core/I18n.ts
export class I18n {
  constructor(...dicts: object[]);          // głęboki merge, późniejsze nadpisują
  t(key: string, vars?: Record<string, string | number>): string; // 'a.b.c', '{n}' interpolacja; brak → zwraca key
  get<T = unknown>(key: string): T;         // np. tablica places
}

// src/core/Rng.ts
export function mulberry32(seed: number): () => number;   // [0,1)
export function pick<T>(rng: () => number, arr: readonly T[]): T;
export function shuffle<T>(rng: () => number, arr: readonly T[]): T[];

// src/core/Assets.ts
export interface GfxManifest { assets: Record<string, { src: string; w: number; h: number }> }
export class AssetRegistry {
  constructor(manifest: GfxManifest);
  async loadGroup(prefix: string): Promise<void>;         // 'hub' → wszystkie aliasy 'hub/*' jako bundle
  texture(alias: string): Texture;                         // brak → Texture.WHITE + console.warn raz
  has(alias: string): boolean;
  size(alias: string): { w: number; h: number } | null;
}
export function sprite(reg: AssetRegistry, alias: string, fallback?: { w: number; h: number; tint?: number }): Sprite;
// gdy brak aliasu: Sprite z Texture.WHITE o rozmiarze fallback i tint (domyślnie 0x8899aa)

// src/core/Audio.ts
export type Moment = string;
export class Audio {
  constructor(moments: Record<Moment, string[]>, baseUrl = '/assets/audio/', available: Set<string>);
  play(moment: Moment, opts?: { loop?: boolean; volume?: number; rate?: number }): number | undefined; // pierwszy dostępny kandydat
  stop(moment: Moment): void; stopAll(): void;
  setMuted(m: boolean): void; get muted(): boolean;        // zapisuje w localStorage 'bk.muted'
  resolve(moment: Moment): string | null;                  // czysta: pierwszy kandydat z `available`
}

// src/core/Scene.ts
export interface SceneContext {
  app: Application; assets: AssetRegistry; audio: Audio; save: Save; i18n: I18n; kiosk: boolean;
  go(sceneId: string, params?: Record<string, string>): void;   // 'hub' | 'game:<gameId>'
}
export abstract class Scene extends Container {
  constructor(protected ctx: SceneContext) { super(); }
  async init(params: Record<string, string>): Promise<void> {}
  enter(): void {}
  update(dt: number): void {}          // dt w sekundach, max 0.1
  exit(): void {}
}

// src/core/SceneManager.ts
export class SceneManager {
  constructor(root: Container, ticker: Ticker, onActivity?: () => void);
  register(id: string, factory: (ctx: SceneContext) => Scene): void;
  async go(id: string, params?: Record<string, string>): Promise<void>; // exit+destroy({children:true}) starej, init→add→enter nowej; pokazuje Loader (Graphics) w trakcie init
  get currentId(): string | null;
}

// src/core/Kiosk.ts
export class IdleTimer { constructor(seconds: number, onIdle: () => void); touch(): void; start(): void; stop(): void; }

// src/games/index.ts
export interface GameEntry { id: 'glass' | 'turnips' | 'mine' | 'herbs'; placeId: string; load: () => Promise<{ default: new (ctx: SceneContext) => Scene }> }
export const GAMES: GameEntry[] = [
  { id: 'glass',   placeId: 'szklarska', load: () => import('./glass/GlassScene') },
  { id: 'turnips', placeId: 'sniezka',   load: () => import('./turnips/TurnipsScene') },
  { id: 'mine',    placeId: 'kowary',    load: () => import('./mine/MineScene') },
  { id: 'herbs',   placeId: 'karpacz',   load: () => import('./herbs/HerbsScene') },
];
```

`src/content/pl.json` (klucze obowiązkowe; treści kart skopiować 1:1 z prototypu w artefakcie — pełne teksty lore/mech są w sekcji „Treści” na końcu planu):

```json
{
  "app": { "title": "Baśnie Karkonoszy", "subtitle": "Seria mini gier o Karkonoszach", "viewpoint": "Widok z Grodnej na południe: Śnieżka po lewej, Szrenica po prawej" },
  "ui": { "back": "Wróć na panoramę", "play": "Zagraj", "soon": "Wkrótce", "next": "Dalej", "again": "Zagraj jeszcze raz", "rotate": "Obróć urządzenie poziomo", "noWebgl": "Twoja przeglądarka nie obsługuje grafiki WebGL. Opis gier znajdziesz w katalogu.", "loading": "Ładowanie", "mute": "Dźwięk", "didYouKnow": "Czy wiesz, że", "stars": "{n} z 3 gwiazdek" },
  "places": [ { "id": "szklarska", "name": "Szklarska Poręba", "title": "Hutnik z Józefiny", "region": "ridge", "lore": "…", "mech": "…", "x": 1488, "y": 600, "game": "glass" } ]
}
```

- [ ] **Step 1: Inicjalizacja projektu**

```bash
cd /home/wojtek/src/woj/karkonosze-game
pnpm init && pnpm add pixi.js@8.22.0 pixi-filters@6.1.5 howler@2.2.4 && pnpm add -D vite@8 typescript@7 vitest@5 @types/howler jsdom @fontsource/fraunces @fontsource/nunito
```
`package.json` scripts: `"dev": "vite --host"`, `"build": "tsc --noEmit && vite build"`, `"test": "vitest run"`, `"fonts": "sh tools/fonts.sh"`. `tsconfig.json`: `strict`, `target ES2022`, `module ESNext`, `moduleResolution bundler`, `resolveJsonModule`, `types: ["vite/client"]`. `vitest.config.ts`: `environment: 'jsdom'`, `include: ['src/**/*.test.ts']`. `.gitignore`: `node_modules dist docs/screenshots tools/assets/raw/* !tools/assets/raw/manifest.lock.json tools/assets/.venv tools/smoke/test-results`.

`tools/fonts.sh` kopiuje z `node_modules/@fontsource/fraunces/files/fraunces-latin-ext-{500,700,900}-normal.woff2` i `node_modules/@fontsource/nunito/files/nunito-latin-ext-{400,600,700,800}-normal.woff2` do `public/fonts/`. Uruchomić i scommitować fonty.

- [ ] **Step 2: Testy czystych funkcji (failing)**

```ts
// src/core/Layout.test.ts
import { describe, it, expect } from 'vitest'; import { fitScale } from './Layout';
describe('fitScale', () => {
  it('letterboxes a wide viewport', () => { const f = fitScale(3840, 1080); expect(f.scale).toBe(1); expect(f.x).toBe(960); expect(f.y).toBe(0); expect(f.portrait).toBe(false); });
  it('fits portrait phone by width and flags portrait', () => { const f = fitScale(390, 844); expect(f.scale).toBeCloseTo(390 / 1920, 5); expect(f.portrait).toBe(true); expect(f.y).toBeGreaterThan(0); });
});
// src/core/Router.test.ts
import { parseRoute } from './Router'; const known = ['szklarska', 'kowary'];
it('reads game from hash', () => expect(parseRoute('#gra=kowary', '', known)).toEqual({ game: 'kowary', kiosk: false }));
it('ignores unknown place', () => expect(parseRoute('#gra=xyz', '', known).game).toBeNull());
it('reads kiosk flag', () => expect(parseRoute('', '?kiosk=1', known).kiosk).toBe(true));
// src/core/Save.test.ts
import { Save } from './Save';
it('keeps best stars and survives missing storage', () => { const s = new Save(null); s.record('glass', 2); s.record('glass', 1); expect(s.load().games.glass.stars).toBe(2); });
it('ignores a throwing storage', () => { const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } }; const s = new Save(bad); expect(() => s.record('mine', 3)).not.toThrow(); expect(s.load().games.mine.stars).toBe(3); });
// src/core/I18n.test.ts
import { I18n } from './I18n';
it('merges and interpolates', () => { const i = new I18n({ a: { b: 'x {n}' } }, { a: { c: 'y' } }); expect(i.t('a.b', { n: 3 })).toBe('x 3'); expect(i.t('a.c')).toBe('y'); expect(i.t('zz')).toBe('zz'); });
// src/core/Rng.test.ts
import { mulberry32, shuffle } from './Rng';
it('is deterministic', () => { expect(mulberry32(7)()).toBe(mulberry32(7)()); expect(shuffle(mulberry32(1), [1,2,3,4])).toHaveLength(4); });
// src/core/Assets.test.ts
import { AssetRegistry } from './Assets'; import { Texture } from 'pixi.js';
it('falls back to white texture for unknown alias', () => { const r = new AssetRegistry({ assets: {} }); expect(r.has('hub/sky')).toBe(false); expect(r.texture('hub/sky')).toBe(Texture.WHITE); });
// src/core/Audio.test.ts
import { Audio } from './Audio';
it('resolves first available candidate', () => { const a = new Audio({ pop: ['glass/pop', 'ui/tap'] }, '/x/', new Set(['ui/tap'])); expect(a.resolve('pop')).toBe('ui/tap'); expect(a.resolve('nope')).toBeNull(); });
```

- [ ] **Step 3: Uruchom testy, mają nie przechodzić** — `pnpm test` → błędy importu.

- [ ] **Step 4: Implementacja `core/`** według interfejsów wyżej. `Save` używa klucza `bk.save.v1`. `Audio` tworzy `Howl({ src: [base + name + '.mp3'], loop, volume })` leniwie i cache'uje po nazwie; `stop(moment)` zatrzymuje Howl rozwiązany dla momentu. `SceneManager.go` ogranicza dt do 0.1 s i woła `onActivity` przy każdym `pointerdown` na stage (dla kiosku). `main.ts`: sprawdza WebGL (`document.createElement('canvas').getContext('webgl2')`, przy braku pokazuje `ui.noWebgl` w DOM), ładuje fonty, `fetch('/assets/gfx/manifest.json')` i `/assets/audio/manifest.json` (brak pliku → pusty rejestr), buduje `SceneContext`, rejestruje `hub` i `game:<id>` dla każdego `GAMES`, czyta `parseRoute(location.hash, location.search, places.map(p=>p.id))`, rusza `hub` albo `game:<id>`; `IdleTimer(60, () => go('hub'))` startuje tylko gdy `kiosk` i scena ≠ hub. Resize: `fitScale` → `root.scale.set(f.scale); root.position.set(f.x, f.y)`; `document.body.classList.toggle('portrait', f.portrait && f.scale*1920 < 700)`. `style.css`: `html,body{height:100%;margin:0;background:#141a26}` `#rotate{display:none}` `.portrait #rotate{display:grid}` (pełnoekranowy overlay z tekstem `ui.rotate`, pointer-events none, półprzezroczysty).

Stuby: `src/hub/PanoramaScene.ts` rysuje gradient `Graphics` i `Text(app.title)`; `src/games/*/…Scene.ts` rysują nazwę gry i przycisk tekstowy „Wróć” (`ctx.go('hub')`). Dzięki temu `pnpm dev` działa od razu.

- [ ] **Step 5: Testy przechodzą** — `pnpm test`; `pnpm build` bez błędów; `pnpm dev` pokazuje stub hubu, `#gra=kowary` otwiera stub Sztolni, `#gra=xyz` hub.

- [ ] **Step 6: Commit** — `feat: app skeleton, core services, routing, stubs`

### Task 2: Pipeline grafiki (fal.ai) i pierwsza partia assetów

**Files:**
- Create: `tools/assets/falkey.py`, `tools/assets/manifest.yaml`, `tools/assets/generate.py`, `tools/assets/cutout.py`, `tools/assets/pack.py`, `tools/assets/test_manifest.py`, `tools/assets/README.md`, `tools/assets/requirements.txt`
- Produces: `public/assets/gfx/**/*.webp`, `public/assets/gfx/manifest.json`, `tools/assets/raw/manifest.lock.json`

**Interfaces (Produces):** `public/assets/gfx/manifest.json` = `{ "assets": { "<kategoria>/<id>": { "src": "gfx/<kategoria>/<id>.webp", "w": 1920, "h": 1080 } } }` (ścieżki względem `/assets/`). Aliasy dokładnie takie jak w tabeli assetów poniżej — gry na nie liczą.

`manifest.yaml`:

```yaml
style:
  dusk: "Illustrated as a layered paper-cut storybook scene with soft gouache texture, muted dusk palette of slate blue, moss green, ochre and plum, gentle rounded shapes, clean silhouettes, no text, no letters, no watermark."
  dark: "Illustrated as a layered paper-cut storybook scene with soft gouache texture, deep umber and slate palette with warm lantern accents, gentle rounded shapes, clean silhouettes, no text, no letters."
  morning: "Illustrated as a layered paper-cut storybook scene with soft gouache texture, fresh morning palette of pale gold, sage green and sky blue, gentle rounded shapes, clean silhouettes, no text, no letters."
cutout_suffix: " Single subject centered on a plain flat light grey background, whole object fully visible, no cast shadow, no ground."
assets:
  - { id: hub/sky, style: dusk, size: [1920, 1080], prompt: "Evening sky over mountains just after sunset, soft gradient from deep indigo at the top through violet to warm apricot at the horizon, a few thin high clouds, a small pale full moon in the upper right, no land, no mountains." }
  - { id: hub/ridge_far, style: dusk, size: [1920, 768], cutout: true, prompt: "A very wide, long mountain ridge with a gently rounded plateau top and smooth slopes, one conical summit on the left third of the image topped with a tiny round stone chapel and two small saucer shaped towers, dark spruce forest at the foot, seen from a valley to the north, hazy blue distance." }
  - { id: hub/ridge_mid, style: dusk, size: [1920, 640], cutout: true, prompt: "A band of low forested foothills in front of mountains, a small medieval castle ruin on a rocky outcrop right of center, a tiny tower ruin on a rounded wooded hill left of center, spruce and beech forest, evening light." }
  - { id: hub/valley, style: dusk, size: [1920, 560], cutout: true, prompt: "Foreground of a wide valley at dusk: meadows and fields, a winding river, a small old town with red roofs and a tall church tower in the center, orchards and country roads, warm window lights." }
  - { id: hub/cloud_1, style: dusk, size: [1024, 512], cutout: true, prompt: "One soft fluffy paper-cut cloud, pale lavender and cream." }
  - { id: hub/cloud_2, style: dusk, size: [1024, 512], cutout: true, prompt: "One long thin paper-cut cloud, pale rose and lavender." }
  - { id: hub/duch_gor, style: dusk, size: [896, 1152], cutout: true, prompt: "Silhouette of a benevolent mountain spirit: a tall old man with a very long flowing beard made of mist, wide brimmed hat, long cloak, a knotted staff, translucent pale blue grey, mysterious and kind." }
  - { id: glass/bg, style: dusk, size: [1920, 1080], prompt: "Interior of a 19th century glassworks: a large brick furnace with a dark round opening in the center left, a sturdy wooden workbench in the front right, shelves with jars and tools on the back wall, cobblestone floor, warm lantern lit, no people, no fire visible." }
  - { id: glass/pipe, style: dusk, size: [1536, 256], cutout: true, prompt: "A long iron glassblowing pipe lying horizontally, dark metal with a wooden grip at one end." }
  - { id: glass/shape_puchar, style: dusk, size: [1024, 1024], cutout: true, prompt: "A frosted white glass goblet with a tall stem and round foot, soft highlights, pale neutral white." }
  - { id: glass/shape_butla, style: dusk, size: [1024, 1024], cutout: true, prompt: "A frosted white glass bottle with a long neck and rounded shoulders, soft highlights, pale neutral white." }
  - { id: glass/shape_flakon, style: dusk, size: [1024, 1024], cutout: true, prompt: "A small frosted white glass apothecary flask with a round stopper, soft highlights, pale neutral white." }
  - { id: glass/shape_kula, style: dusk, size: [1024, 1024], cutout: true, prompt: "A frosted white glass sphere with a small neck, soft highlights, pale neutral white." }
  - { id: glass/shape_wazon, style: dusk, size: [1024, 1024], cutout: true, prompt: "A frosted white glass vase with a wide belly and narrow flared neck, soft highlights, pale neutral white." }
  - { id: glass/glob, style: dusk, size: [768, 768], cutout: true, prompt: "A soft blob of molten glass, warm orange fading to pale yellow at the center, smooth and rounded." }
  - { id: glass/mold, style: dusk, size: [768, 768], cutout: true, prompt: "An open two part wooden glass blowing mold with iron bands, dark oiled wood." }
  - { id: glass/jar_kobalt, style: dusk, size: [640, 768], cutout: true, prompt: "A small glass apothecary jar with a cork, filled with deep blue mineral powder, blank paper label." }
  - { id: glass/jar_zelazo, style: dusk, size: [640, 768], cutout: true, prompt: "A small glass apothecary jar with a cork, filled with dark green mineral powder, blank paper label." }
  - { id: glass/jar_zloto, style: dusk, size: [640, 768], cutout: true, prompt: "A small glass apothecary jar with a cork, filled with ruby red mineral powder, blank paper label." }
  - { id: glass/jar_mangan, style: dusk, size: [640, 768], cutout: true, prompt: "A small glass apothecary jar with a cork, filled with violet mineral powder, blank paper label." }
  - { id: glass/jar_uran, style: dusk, size: [640, 768], cutout: true, prompt: "A small glass apothecary jar with a cork, filled with yellow green mineral powder, blank paper label." }
  - { id: glass/portrait_hrabina, style: dusk, size: [768, 768], cutout: true, prompt: "Bust portrait of a 19th century countess, elegant dark green dress with lace collar, hair pinned up, proud kind face, storybook character." }
  - { id: glass/portrait_walon, style: dusk, size: [768, 768], cutout: true, prompt: "Bust portrait of a medieval mountain prospector with a hood, weathered face, leather satchel and a small lantern, secretive smile, storybook character." }
  - { id: glass/portrait_laborant, style: dusk, size: [768, 768], cutout: true, prompt: "Bust portrait of an 18th century mountain herbalist in a long coat and wide hat, round spectacles, a bundle of herbs on his shoulder, gentle face, storybook character." }
  - { id: glass/portrait_duch, style: dusk, size: [768, 768], cutout: true, prompt: "Bust portrait of an ancient mountain spirit, enormous beard like drifting mist, wide hat, deep set wise eyes, pale blue grey skin, storybook character." }
  - { id: glass/portrait_pohl, style: dusk, size: [768, 768], cutout: true, prompt: "Bust portrait of an 1840s master glassblower, leather apron, rolled sleeves, thick moustache, confident face, storybook character." }
  - { id: turnips/bg, style: dusk, size: [1920, 1080], prompt: "A high mountain meadow on a broad plateau at dusk, a small round stone chapel on the hilltop in the upper left and two saucer shaped towers beside it, a stone path winding up, empty dark soil furrows of a vegetable field in the foreground, dramatic clouds." }
  - { id: turnips/turnip, style: dusk, size: [512, 640], cutout: true, prompt: "One whole turnip, purple top fading to white bottom, with a tuft of green leaves." }
  - { id: turnips/mound, style: dusk, size: [512, 256], cutout: true, prompt: "A small mound of dark soil with a hole in the middle." }
  - { id: turnips/stone, style: dusk, size: [512, 400], cutout: true, prompt: "A rounded grey granite stone with patches of yellow lichen." }
  - { id: turnips/emma_1, style: dusk, size: [640, 960], cutout: true, prompt: "A young princess in a flowing medieval blue gown running to the right, long blond braid flying, small golden circlet, storybook character, side view." }
  - { id: turnips/emma_2, style: dusk, size: [640, 960], cutout: true, route: edit, ref: turnips/emma_1, prompt: "Same character, same style and colors, next frame of the run cycle: other leg forward, arms swapped." }
  - { id: mine/bg_1, style: dark, size: [1920, 1080], prompt: "Cross section of a 12th century mine tunnel, rough grey rock walls, heavy wooden support beams, a low ceiling, scattered stones on the floor, evenly dim lit, no people, no lamps." }
  - { id: mine/bg_2, style: dark, size: [1920, 1080], prompt: "Cross section of a 19th century mine gallery, rock walls with timber supports, iron rails on the floor, a wooden ladder, evenly dim lit, no people, no lamps." }
  - { id: mine/bg_3, style: dark, size: [1920, 1080], prompt: "Cross section of a 1950s uranium mine, concrete and steel supports, cables along the wall, ventilation pipe, evenly dim lit, no people, no lamps." }
  - { id: mine/vein_iron, style: dark, size: [512, 400], cutout: true, prompt: "A chunk of grey rock with rusty red brown iron ore streaks." }
  - { id: mine/vein_uranium, style: dark, size: [512, 400], cutout: true, prompt: "A chunk of dark rock with a crust of yellow green mineral crystals, matte, no glow." }
  - { id: mine/lamp, style: dark, size: [512, 768], cutout: true, prompt: "An old brass miner's oil lamp with a glass window and a hook, unlit." }
  - { id: mine/pickaxe, style: dark, size: [640, 640], cutout: true, prompt: "A miner's pickaxe with a worn wooden handle." }
  - { id: mine/bat, style: dark, size: [640, 400], cutout: true, prompt: "A small brown bat with wings spread, flying, friendly storybook look." }
  - { id: mine/cart, style: dark, size: [896, 640], cutout: true, prompt: "A wooden mine cart on iron wheels filled with ore." }
  - { id: mine/geiger, style: dark, size: [448, 512], cutout: true, prompt: "A 1950s handheld Geiger counter with a round dial and a wand." }
  - { id: herbs/bg_far, style: morning, size: [1920, 1080], prompt: "Morning view up a forested mountain slope toward a distant conical summit with a tiny chapel on top, spruce forest, mist in the valley, soft sunlight, no path in the foreground." }
  - { id: herbs/strip_mid, style: morning, size: [2048, 640], cutout: true, prompt: "A long horizontal band of spruce forest edge with mossy boulders and ferns, seen from the side, morning light." }
  - { id: herbs/strip_near, style: morning, size: [2048, 448], cutout: true, prompt: "A long horizontal band of mountain meadow with a stony footpath, grass tufts and small rocks, seen from the side." }
  - { id: herbs/plant_arnika, style: morning, size: [512, 640], cutout: true, prompt: "One whole arnica plant with bright yellow orange daisy like flowers and a straight stem." }
  - { id: herbs/plant_goryczka, style: morning, size: [512, 640], cutout: true, prompt: "One whole gentian plant with deep blue trumpet flowers." }
  - { id: herbs/plant_dziewieciesil, style: morning, size: [512, 640], cutout: true, prompt: "One whole stemless carline thistle with a large silvery white flat flower and spiny leaves." }
  - { id: herbs/plant_podbial, style: morning, size: [512, 640], cutout: true, prompt: "One whole coltsfoot plant with yellow dandelion like flowers on scaly stems." }
  - { id: herbs/plant_pierwiosnek, style: morning, size: [512, 640], cutout: true, prompt: "One whole cowslip primrose plant with a cluster of nodding yellow flowers." }
  - { id: herbs/plant_prawoslaz, style: morning, size: [512, 640], cutout: true, prompt: "One whole marshmallow plant with pale pink flowers and velvety leaves." }
  - { id: herbs/plant_piolun, style: morning, size: [512, 640], cutout: true, prompt: "One whole wormwood plant with silvery grey feathery leaves and tiny yellow buds." }
  - { id: herbs/plant_mieta, style: morning, size: [512, 640], cutout: true, prompt: "One whole mint plant with bright green toothed leaves and a purple flower spike." }
  - { id: herbs/plant_muchomor, style: morning, size: [512, 640], cutout: true, prompt: "One red fly agaric mushroom with white spots." }
  - { id: herbs/plant_pokrzywa, style: morning, size: [512, 640], cutout: true, prompt: "One whole stinging nettle plant with serrated dark green leaves." }
  - { id: herbs/laborant_1, style: morning, size: [768, 1024], cutout: true, prompt: "An 18th century mountain herbalist walking to the right with a wicker basket and a walking staff, long coat, wide hat, round spectacles, side view, storybook character." }
  - { id: herbs/laborant_2, style: morning, size: [768, 1024], cutout: true, route: edit, ref: herbs/laborant_1, prompt: "Same character, same style and colors, next frame of the walk cycle: other leg forward, staff lifted." }
  - { id: herbs/mortar, style: morning, size: [640, 640], cutout: true, prompt: "A grey stone apothecary mortar, empty, side view." }
  - { id: herbs/pestle, style: morning, size: [320, 640], cutout: true, prompt: "A grey stone pestle, upright." }
  - { id: herbs/basket, style: morning, size: [640, 512], cutout: true, prompt: "A wicker basket with a handle, empty, side view." }
```

Trasy: `route: flux` (domyślna) → `fal-ai/flux-pro/v1.1` z `image_size: {width, height}`, `safety_tolerance: "5"`, `enable_safety_checker: false`; `route: edit` → `fal-ai/nano-banana-pro/edit` z `image_urls: [upload(raw/<ref>.png)]`; wycinanie → `fal-ai/birefnet` z `image_url = fal_client.upload_file(raw/<id>.png)`.

- [ ] **Step 1: Test manifestu (failing)**

```python
# tools/assets/test_manifest.py  (uruchamiać: .venv/bin/python -m pytest tools/assets -q)
import re, yaml, pathlib
M = yaml.safe_load((pathlib.Path(__file__).parent / "manifest.yaml").read_text())
FIRE = re.compile(r"\b(fire|flames?|glow(ing)?|burning|sparks?|embers?)\b", re.I)
def test_ids_unique_and_namespaced():
    ids = [a["id"] for a in M["assets"]]; assert len(ids) == len(set(ids)); assert all("/" in i for i in ids)
def test_no_baked_fx_outside_negation():
    for a in M["assets"]:
        for m in FIRE.finditer(a["prompt"]):
            ctx = a["prompt"][max(0, m.start()-12):m.start()].lower()
            assert "no " in ctx or "not " in ctx or "unlit" in ctx, (a["id"], m.group())
def test_sizes_are_multiples_of_16_and_within_flux_limits():
    for a in M["assets"]:
        w, h = a["size"]; assert w % 16 == 0 and h % 16 == 0 and max(w, h) <= 2048, a["id"]
def test_edit_refs_exist():
    ids = {a["id"] for a in M["assets"]}
    for a in M["assets"]:
        if a.get("route") == "edit": assert a["ref"] in ids
```
Uwaga: `glass/glob` ma „molten glass” bez słów ognia — OK; `mine/lamp` ma „unlit”.

- [ ] **Step 2: Uruchom test → FAIL (brak manifest.yaml)**; napisz `manifest.yaml` jak wyżej, `uv pip install pytest`; test PASS.

- [ ] **Step 3: `falkey.py`, `generate.py`, `cutout.py`, `pack.py`**

```python
# falkey.py
import os, re, pathlib
def fal_key() -> str:
    if os.environ.get("FAL_KEY"): return os.environ["FAL_KEY"]
    for line in (pathlib.Path.home() / ".api_keys").read_text().splitlines():
        m = re.match(r"^\s*fal:\s*(\S+)", line)
        if m: return m.group(1)
    raise SystemExit("FAL_KEY not set and no 'fal:' line in ~/.api_keys")
```
`generate.py [--only PREFIX] [--force ID]`: dla każdego assetu bez `raw/<id>.png` (katalogi tworzyć) woła trasę, zapisuje PNG (konwersja z jpg przez Pillow), dopisuje do `raw/manifest.lock.json` `{id: {model, prompt, seed, url, size, generated_at}}`; równolegle `ThreadPoolExecutor(max_workers=4)`; błędy loguje i idzie dalej; na końcu wypisuje tabelę OK/FAIL.
`cutout.py [--only PREFIX]`: dla assetów `cutout: true` bez `raw/<id>.cut.png` → birefnet → PNG RGBA; potem kontrola „birefnet zjadł wnętrze”: jeśli > 20 % pikseli wewnątrz wypukłej otoczki maski ma alpha < 128, wypełnij alpha=255 z surowego obrazu wewnątrz konturu (Pillow + numpy; `uv pip install numpy`).
`pack.py [--check]`: dla każdego assetu: źródło = `.cut.png` jeśli cutout, inaczej `.png`; cutout → `getbbox()` + margines 8 px (trim); zapis `public/assets/gfx/<id>.webp` (`quality=88`, `method=6`); tła bez przezroczystości `quality=84`; buduje `public/assets/gfx/manifest.json` z `{src, w, h}`; `--check` sprawdza, że każdy wpis manifestu ma plik, suma ≤ 40 MB i każdy bok ≤ 4096. Każdy skrypt ma `README.md` z komendami.

- [ ] **Step 4: Wygeneruj wszystko** — `generate.py`, obejrzyj `raw/hub/*.png` (Read), popraw prompty tych, które nie wyszły (zwłaszcza: grzbiet ma być łagodny, Śnieżka po lewej, flakon/kula białe), `--force` dla poprawianych, potem `cutout.py`, `pack.py --check`. Obejrzyj co najmniej: `hub/ridge_far.cut`, `glass/shape_kula.cut`, `glass/portrait_duch.cut`, `turnips/turnip.cut`, `herbs/plant_dziewieciesil.cut`. Zanotuj w `tools/assets/README.md` sekcję „Decyzje” (co i dlaczego poprawiono).

- [ ] **Step 5: Commit** — `feat(assets): fal.ai image pipeline + first full asset set` (webp + manifest.json + lock; bez raw/).

### Task 3: Pipeline dźwięku

**Files:**
- Create: `tools/assets/audio_manifest.yaml`, `tools/assets/audio.py`, `tools/assets/test_audio_manifest.py`
- Produces: `public/assets/audio/<kategoria>/<id>.mp3`, `public/assets/audio/manifest.json` = `{ "clips": { "<kategoria>/<id>": { "src": "audio/<kategoria>/<id>.mp3", "seconds": 3.2, "loop": false } } }`

**Interfaces (Produces):** nazwy klipów (gry odwołują się do nich przez tabelę momentów w `core/Audio.ts` — Task 4 wpisuje tę tabelę):

```yaml
# audio_manifest.yaml
routes:
  sfx:   { model: fal-ai/stable-audio-25/text-to-audio, fallback: cassetteai/sound-effects-generator }
  music: { model: fal-ai/stable-audio-25/text-to-audio, fallback: cassetteai/music-generator }
clips:
  - { id: music/hub,     route: music, seconds: 45, loop: true,  prompt: "gentle mountain folk lullaby, hammered dulcimer and soft wooden flute, slow, mysterious and warm, storybook, seamless loop, no vocals" }
  - { id: music/glass,   route: music, seconds: 45, loop: true,  prompt: "warm workshop waltz, accordion and plucked strings, cozy, unhurried, storybook, seamless loop, no vocals" }
  - { id: music/turnips, route: music, seconds: 45, loop: true,  prompt: "playful mischievous folk tune, pizzicato strings, clarinet, light percussion, mountain wind, seamless loop, no vocals" }
  - { id: music/mine,    route: music, seconds: 45, loop: true,  prompt: "dark ambient drone deep underground, distant metallic echoes, slow low cello, sparse, seamless loop, no vocals" }
  - { id: music/herbs,   route: music, seconds: 45, loop: true,  prompt: "bright pastoral morning tune, acoustic guitar and recorder, birdsong feel, unhurried, seamless loop, no vocals" }
  - { id: ui/tap,        route: sfx, seconds: 1,  prompt: "soft wooden tap, short, warm" }
  - { id: ui/success,    route: sfx, seconds: 2,  prompt: "small bright glockenspiel arpeggio, success chime" }
  - { id: ui/fail,       route: sfx, seconds: 1.5, prompt: "soft low wooden thud with a short descending tone, gentle failure" }
  - { id: ui/star,       route: sfx, seconds: 1.2, prompt: "single sparkling bell ding" }
  - { id: glass/furnace, route: sfx, seconds: 8, loop: true, prompt: "deep roaring furnace loop, steady low rumble of a large brick kiln, air draft" }
  - { id: glass/blow,    route: sfx, seconds: 4, loop: true, prompt: "steady soft hiss of air blown through a long metal pipe" }
  - { id: glass/pop,     route: sfx, seconds: 1, prompt: "a thin glass bubble bursting, short pop with light tinkle" }
  - { id: glass/pigment, route: sfx, seconds: 1.5, prompt: "a pinch of fine powder poured onto hot glass, soft sizzle" }
  - { id: glass/mold,    route: sfx, seconds: 1, prompt: "two heavy wooden halves clapping shut, dull clack" }
  - { id: glass/fanfare, route: sfx, seconds: 3, prompt: "short cheerful brass and bell fanfare, storybook" }
  - { id: turnips/pop,   route: sfx, seconds: 0.8, prompt: "a vegetable popping out of soil, short cartoon pop" }
  - { id: turnips/steps, route: sfx, seconds: 2, prompt: "quick light running footsteps on a stony path" }
  - { id: turnips/thunder, route: sfx, seconds: 3, prompt: "distant rolling thunder over mountains" }
  - { id: turnips/wind,  route: sfx, seconds: 8, loop: true, prompt: "steady high mountain wind loop, airy, no music" }
  - { id: turnips/grumble, route: sfx, seconds: 2, prompt: "deep grumpy giant grumbling, low, comic, no words" }
  - { id: mine/drip,     route: sfx, seconds: 8, loop: true, prompt: "water dripping in a cave, echoing, sparse, loop" }
  - { id: mine/geiger_slow, route: sfx, seconds: 4, loop: true, prompt: "geiger counter clicking slowly, sparse clicks" }
  - { id: mine/geiger_fast, route: sfx, seconds: 4, loop: true, prompt: "geiger counter clicking very fast, dense crackle" }
  - { id: mine/pick,     route: sfx, seconds: 1, prompt: "a pickaxe striking rock once, sharp clink with small debris" }
  - { id: mine/bat,      route: sfx, seconds: 1.5, prompt: "a bat flapping past quickly with a tiny squeak" }
  - { id: mine/rumble,   route: sfx, seconds: 2.5, prompt: "a low rock rumble underground, falling pebbles" }
  - { id: mine/bell,     route: sfx, seconds: 2.5, prompt: "an old iron shift bell rung twice, echoing in a tunnel" }
  - { id: herbs/steps,   route: sfx, seconds: 4, loop: true, prompt: "slow walking footsteps on gravel mountain path, loop" }
  - { id: herbs/pluck,   route: sfx, seconds: 0.8, prompt: "snapping a plant stem, soft leafy rustle" }
  - { id: herbs/sneeze,  route: sfx, seconds: 1.2, prompt: "a comic small sneeze, cartoon, no words" }
  - { id: herbs/grind,   route: sfx, seconds: 4, loop: true, prompt: "stone pestle grinding herbs in a stone mortar, circular scraping, loop" }
  - { id: herbs/pour,    route: sfx, seconds: 1.5, prompt: "liquid poured into a small glass bottle, gentle gurgle" }
  - { id: herbs/birds,   route: sfx, seconds: 8, loop: true, prompt: "morning birdsong in a spruce forest, light breeze, loop" }
```

- [ ] **Step 1: Test manifestu (failing)**: id unikalne, `seconds` 0.5–60, każdy `route` w `routes`, `loop` tylko z `seconds >= 4`.
- [ ] **Step 2: `audio.py`**: `uv pip install imageio-ffmpeg numpy soundfile`; `FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()`. Dla każdego klipu bez `raw/audio/<id>.wav`: woła model (stable-audio: `{prompt, seconds_total}`; przy wyjątku fallback), pobiera wav. Kontrola ciszy: `soundfile` → peak dBFS; `< -40` → ponów (max 3). Normalizacja przez ffmpeg: `-af loudnorm=I=<target>:TP=-3:LRA=11` z celami: music −20, pętle tła −23, UI −18, efekty −16; dla `loop: true` przycina do pełnej sekundy i robi crossfade 150 ms końca na początek (numpy) przed enkodowaniem; eksport `-c:a libmp3lame -q:a 3`. Zapisuje `public/assets/audio/manifest.json` i lock `raw/audio.lock.json`. `--check`: każdy mp3 istnieje, suma ≤ 10 MB, dekoduje się (ffmpeg `-f null -`).
- [ ] **Step 3: Wygeneruj, odsłuchać nie da się — sprawdź `--check` i wypisz tabelę (id, sekundy, peak dBFS, rozmiar).**
- [ ] **Step 4: Commit** — `feat(audio): fal.ai sound pipeline + 34 clips`.

---

## Fala 2 (po Task 1): Task 4

### Task 4: Motyw, UI kit, shadery, tabela momentów dźwięku

**Files:**
- Create: `src/ui/Theme.ts`, `src/ui/Button.ts`, `src/ui/HoldButton.ts`, `src/ui/SpeechBubble.ts`, `src/ui/Stars.ts`, `src/ui/FactCard.ts`, `src/ui/RoundProgress.ts`, `src/ui/TopBar.ts`, `src/ui/Portrait.ts`, `src/ui/Loader.ts`
- Create: `src/core/fx/shaders.ts`, `src/core/fx/HeatHazeFilter.ts`, `src/core/fx/FogFilter.ts`, `src/core/fx/LampLightFilter.ts`, `src/core/fx/WeatherFilter.ts`
- Create: `src/core/moments.ts`
- Modify: `src/core/Audio.ts` (import tabeli), `src/main.ts` (TopBar nie — sceny same)
- Test: `src/ui/Theme.test.ts` (hit-box kiosk), `src/core/fx/shaders.test.ts` (każdy fragment zawiera `finalColor`, `vTextureCoord`, brak `gl_FragColor`), `src/core/moments.test.ts` (każdy kandydat ma format `kat/id`)

**Interfaces (Produces):**

```ts
// Theme.ts
export const Theme = {
  font: { display: 'Fraunces', body: 'Nunito' },
  color: { ink: 0x1f2b2e, paper: 0xf6ead6, ember: 0xdd8a2c, emberSoft: 0xf7e2c6, glass: 0x2a8a6b, dusk: 0x5a4a8c, night: 0x141a26, star: 0xffcf66, bad: 0xc2304a },
  size: { button: { h: 96, minW: 240, radius: 28 }, hitMin: (kiosk: boolean) => (kiosk ? 96 : 64) },
  text: { title: (size = 56) => new TextStyle({ fontFamily: 'Fraunces', fontWeight: '700', fontSize: size, fill: 0xf6ead6 }), body: (size = 30, fill = 0xf6ead6) => new TextStyle({ fontFamily: 'Nunito', fontWeight: '600', fontSize: size, fill, wordWrap: true, wordWrapWidth: 900, lineHeight: size * 1.35 }) }
};
// Button.ts
export interface ButtonOpts { width?: number; height?: number; variant?: 'primary' | 'quiet' | 'ghost'; icon?: Texture; kiosk?: boolean; onPress?: () => void }
export class Button extends Container { constructor(label: string, opts?: ButtonOpts); setLabel(s: string): void; set enabled(v: boolean); }
// pointerdown → scale .96 + ctx audio 'ui.tap' (przez callback opts.onTap?), pointerup wewnątrz → onPress; pointerupoutside → tylko reset
// HoldButton.ts
export class HoldButton extends Button { onHoldStart?: () => void; onHoldEnd?: () => void; get holding(): boolean }
// setPointerCapture; kończy hold na pointerup, pointerupoutside, pointercancel, i gdy okno traci focus (window 'blur')
// SpeechBubble.ts
export class SpeechBubble extends Container { constructor(opts: { portrait: Texture; name: string; text: string; width?: number }); setText(t: string): void; }
// Stars.ts
export class Stars extends Container { constructor(max = 3, size = 56); set(n: number, animate = true): void; }
// FactCard.ts
export class FactCard extends Container { constructor(label: string, text: string, width = 900); }
// RoundProgress.ts
export class RoundProgress extends Container { constructor(total: number, width = 600); set(done: number): void; }
// TopBar.ts
export class TopBar extends Container { constructor(opts: { title: string; subtitle?: string; backLabel: string; onBack: () => void; audio: Audio; muteLabel: string; kiosk: boolean }); setSubtitle(s: string): void; }
// Portrait.ts  — okrągły portret z obwódką
export class Portrait extends Container { constructor(tex: Texture, diameter = 160); }
// Loader.ts
export class Loader extends Container { constructor(label: string); update(dt: number): void; }

// fx
export class HeatHazeFilter extends Filter { constructor(); time: number; intensity: number /*0..1*/; rect: [x,y,w,h] /*w uv 0..1 obszaru pieca*/ }
export class FogFilter extends Filter { constructor(); time: number; density: number; color: [r,g,b]; drift: number; bottom: number /*uv od którego mgła*/ }
export class LampLightFilter extends Filter { constructor(); light: [x,y] /*uv*/; radius: number /*uv*/; ambient: number; flicker: number; time: number; }
export class WeatherFilter extends Filter { constructor(); mode: 0|1|2|3|4 /*none, fog, rain, snow, sun*/; intensity: number; time: number; }
```

GLSL (fragmenty, w `shaders.ts` jako stałe; wierzchołkowy wspólny z ściągi):

```glsl
// HeatHaze
in vec2 vTextureCoord; out vec4 finalColor; uniform sampler2D uTexture; uniform float uTime; uniform float uIntensity; uniform vec4 uRect;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
void main(){ vec2 uv=vTextureCoord; vec2 d=(uv-uRect.xy)/uRect.zw; float inside=step(0.0,d.x)*step(d.x,1.0)*step(0.0,d.y)*step(d.y,1.0); float fall=inside*smoothstep(1.0,0.4,length(d-0.5)*2.0);
 float n=noise(vec2(uv.x*40.0, uv.y*30.0 - uTime*2.5))-0.5; uv.x += n*0.012*uIntensity*fall; uv.y += (noise(vec2(uv.x*30.0+9.0, uv.y*40.0 - uTime*3.0))-0.5)*0.008*uIntensity*fall;
 vec4 c=texture(uTexture, uv); c.rgb += vec3(0.25,0.12,0.0)*fall*uIntensity*(0.6+0.4*sin(uTime*7.0)); finalColor=c; }
// Fog: fbm 4 oktawy, mgła = density * smoothstep(bottom, 1.0, uv.y) * (0.6+0.4*fbm(uv*3 + time*drift)); finalColor = mix(c, vec4(color,1)*c.a, fog)
// LampLight: float d=distance(vTextureCoord*uAspect, uLight*uAspect); float l=smoothstep(uRadius, uRadius*0.15, d); l*= 1.0 - uFlicker*0.5*(0.5+0.5*sin(uTime*23.0)*sin(uTime*7.3)); vec3 warm=vec3(1.0,0.86,0.62); finalColor = vec4(c.rgb*(uAmbient + l*warm), c.a);
// Weather: mode 1 = Fog; mode 2 = deszcz: streaks = step(0.985, hash(vec2(floor(uv.x*220.0), floor((uv.y+uTime*1.6)*6.0)))) → białe kreski; mode 3 = śnieg: 2 warstwy płatków z hash i sin drift; mode 4 = promienie: god rays z góry-lewa (dot kierunek, fbm). Każdy mnożony przez uIntensity.
```

`moments.ts` (klucze używane przez gry — hub i gry odwołują się TYLKO do tych nazw):

```ts
export const MOMENTS: Record<string, string[]> = {
  'ui.tap': ['ui/tap'], 'ui.success': ['ui/success'], 'ui.fail': ['ui/fail'], 'ui.star': ['ui/star'],
  'hub.music': ['music/hub'], 'hub.wind': ['turnips/wind'],
  'glass.music': ['music/glass'], 'glass.furnace': ['glass/furnace'], 'glass.blow': ['glass/blow'], 'glass.pop': ['glass/pop', 'ui/fail'], 'glass.pigment': ['glass/pigment'], 'glass.mold': ['glass/mold', 'ui/tap'], 'glass.fanfare': ['glass/fanfare', 'ui/success'],
  'turnips.music': ['music/turnips'], 'turnips.pop': ['turnips/pop', 'ui/tap'], 'turnips.steps': ['turnips/steps'], 'turnips.thunder': ['turnips/thunder'], 'turnips.wind': ['turnips/wind'], 'turnips.correct': ['ui/success'], 'turnips.wrong': ['ui/fail'], 'turnips.grumble': ['turnips/grumble'],
  'mine.music': ['music/mine'], 'mine.drip': ['mine/drip'], 'mine.geigerSlow': ['mine/geiger_slow'], 'mine.geigerFast': ['mine/geiger_fast'], 'mine.pick': ['mine/pick', 'ui/tap'], 'mine.bat': ['mine/bat'], 'mine.rumble': ['mine/rumble'], 'mine.bell': ['mine/bell', 'ui/success'],
  'herbs.music': ['music/herbs'], 'herbs.steps': ['herbs/steps'], 'herbs.pluck': ['herbs/pluck', 'ui/tap'], 'herbs.sneeze': ['herbs/sneeze', 'ui/fail'], 'herbs.grind': ['herbs/grind'], 'herbs.pour': ['herbs/pour'], 'herbs.birds': ['herbs/birds'],
};
```

- [ ] Step 1: testy (failing) → Step 2: implementacja → Step 3: `pnpm test`, `pnpm build` → Step 4: demo: stub hubu tymczasowo pokazuje każdy komponent i każdy filtr na prostokącie (do usunięcia w Task 5; szybki zrzut do `docs/screenshots/ui-kit.png` przez `pnpm dev` + Playwright w Task 12 albo ręcznie) → Step 5: commit `feat(ui,fx): theme, UI kit, GLSL filters, audio moments`.

---

## Fala 3 (równolegle, po Task 4; każdy w osobnym worktree): Task 5–9

Wspólne zasady fali 3: scena ładuje tylko swoją grupę assetów (`ctx.assets.loadGroup('glass')`), gra czyta teksty przez `ctx.i18n.t('glass.…')` z własnego `pl.json` (import w scenie i `ctx.i18n` już zawiera go — `main.ts` w Task 1 importuje `games/*/pl.json` statycznie i podaje do `new I18n(core, glass, turnips, mine, herbs)`; każdy plik ma jeden klucz główny: `glass`, `turnips`, `mine`, `herbs`). Każda scena: `TopBar` u góry (wysokość 110), `RoundProgress` pod nim, wynik przez `ctx.save.record(id, stars, params.field === '1')`, przyciski ≥ `Theme.size.hitMin(ctx.kiosk)`. Każda runda ma limit czasu (podany niżej) — po jego upływie runda kończy się jako nieudana i gra idzie dalej. Logika punktacji w `rules.ts` (czyste funkcje, testy), scena tylko ją woła.

### Task 5: Hub — PanoramaScene

**Files:** `src/hub/PanoramaScene.ts`, `src/hub/Parallax.ts`, `src/hub/Markers.ts`, `src/hub/ConceptCard.ts`, `src/hub/hub.test.ts` (czyste: `markerBadge(save, placeId)`), modyfikacja `src/content/pl.json` (współrzędne markerów po obejrzeniu wygenerowanego tła).

Zachowanie: warstwy `hub/sky` (1920×1080, bez parallaxu), `hub/ridge_far` (y dopasowane tak, by grzbiet zaczynał się ok. 300 px; parallax 0.15), `hub/ridge_mid` (parallax 0.3), `hub/valley` (dół ekranu, parallax 0.5), 2 chmury (`hub/cloud_*`, dryf 12–20 px/s, zawijanie), gwiazdy 60× `Graphics` kółko o losowej alfie migoczące (sin), `hub/duch_gor` nad Śnieżką alfa 0.25 z powolnym oddechem (skala ±2 %), `FogFilter` na warstwie `valley` (density 0.35, bottom 0.55). Parallax: pozycja wskaźnika względem środka → przesunięcie warstw o `±40 px * factor`, wygładzone (lerp 3/s); na dotyku to samo przy `pointermove`. 17 markerów z `places`: kółko 22 px (ember dla hubu/Staniszów, glass dla gier w produkcji, paper dla koncepcji) + etykieta (Nunito 800, 26 px, obrys), hit-area 96×96. Marker gry → `ctx.go('game:<id>')`; marker koncepcji → `ConceptCard` (panel 1100×520 na środku: nazwa, tytuł, lore, mechanika, chip „Wkrótce”, przycisk zamknij). Odznaka: jeśli `save.games[gameId]` → `Stars` (3×28 px) nad markerem. Tytuł `app.title` (Fraunces 900, 84 px) w lewym górnym rogu z `app.viewpoint` pod spodem (Nunito 26). Przycisk dźwięku w prawym górnym rogu. Muzyka `hub.music` (loop, vol 0.5) + `hub.wind` (vol 0.25) po pierwszym `pointerdown` (autoplay policy).

Test: `markerBadge({games:{glass:{stars:2,…}}}, GAMES, 'szklarska') === 2`, nieznane → 0.

Commit: `feat(hub): panorama scene with parallax, markers, concept cards`.

### Task 6: Hutnik z Józefiny — `games/glass`

**Files:** `src/games/glass/rules.ts`, `rules.test.ts`, `pl.json`, `GlassScene.ts`, `steps/Heat.ts`, `steps/Blow.ts`, `steps/Color.ts`, `steps/Shape.ts`, `steps/Result.ts`

`rules.ts`:

```ts
export type MineralId = 'kobalt' | 'zelazo' | 'zloto' | 'mangan' | 'uran';
export type ShapeId = 'puchar' | 'butla' | 'flakon' | 'kula' | 'wazon';
export interface Customer { id: 'hrabina' | 'walon' | 'laborant' | 'duch' | 'pohl'; shape: ShapeId; mineral: MineralId; size: 'maly' | 'duzy' }
export const MINERALS: { id: MineralId; tint: number }[] = [{ id: 'kobalt', tint: 0x3a6fd8 }, { id: 'zelazo', tint: 0x3f8f5a }, { id: 'zloto', tint: 0xc2304a }, { id: 'mangan', tint: 0x7d4fa3 }, { id: 'uran', tint: 0xb9d93a }];
export const SHAPES: ShapeId[] = ['puchar', 'butla', 'flakon', 'kula', 'wazon'];
export const CUSTOMERS: Customer[] = [ { id: 'hrabina', shape: 'puchar', mineral: 'zloto', size: 'duzy' }, { id: 'walon', shape: 'butla', mineral: 'zelazo', size: 'maly' }, { id: 'laborant', shape: 'flakon', mineral: 'mangan', size: 'maly' }, { id: 'duch', shape: 'kula', mineral: 'kobalt', size: 'duzy' }, { id: 'pohl', shape: 'wazon', mineral: 'uran', size: 'duzy' } ];
export const HEAT = { zoneHalf: 0.19, missScore: 0.15 };
export const BLOW = { target: { maly: 150, duzy: 230 }, popFactor: 1.3, growPerSec: 140, popPenalty: 0.7 };
export function heatScore(pos: number): number { const d = Math.abs(pos - 0.5); return d <= HEAT.zoneHalf ? 1 - d * 2 : HEAT.missScore; }
export function needlePos(t: number): number { return (Math.sin(t * 2.6) + 1) / 2; }
export function blowScore(r: number, target: number, pops: number): number { const err = Math.abs(r - target) / target; return Math.max(0.1, 1 - err * 2.2) * (pops ? BLOW.popPenalty : 1); }
export function popped(r: number, target: number): boolean { return r > target * BLOW.popFactor; }
export function orderScore(p: { heat: number; blow: number; mineralOk: boolean; shapeOk: boolean }): number { return p.heat + p.blow + (p.mineralOk ? 1 : 0) + (p.shapeOk ? 1 : 0); }
export function starsFor(score: number): 1 | 2 | 3 { return score >= 3.3 ? 3 : score >= 2.1 ? 2 : 1; }
export function pickOrders(rng: () => number, n = 3): Customer[] { return shuffle(rng, CUSTOMERS).slice(0, n); }
export function summaryTitle(total: number): 'master' | 'glassblower' | 'apprentice' { return total >= 8 ? 'master' : total >= 5 ? 'glassblower' : 'apprentice'; }
export function reactionKey(stars: 1 | 2 | 3): 'ok' | 'meh' | 'bad' { return stars === 3 ? 'ok' : stars === 2 ? 'meh' : 'bad'; }
```

Testy (min.): `heatScore(0.5)===1`, `heatScore(0.9)===0.15`, `blowScore(230,230,0)===1`, `blowScore(230,230,1)` ≈ 0.7, `popped(300,230)===true`, `starsFor(orderScore({heat:1,blow:1,mineralOk:true,shapeOk:true}))===3`, `starsFor(orderScore({heat:.15,blow:.1,mineralOk:false,shapeOk:true}))===1`, `pickOrders(mulberry32(1))` ma 3 różne id, `summaryTitle(9)==='master'`.

`pl.json` (`glass`): `title`, `intro.h`, `intro.p`, `intro.start`, `heat.h/p/btn`, `blow.h/p/btn/pop`, `color.h/p`, `shape.h/p`, `next`, `finish`, `again`, `sum.h`, `orderNo` („Zamówienie {i} z {n}”), `customers.<id>.name/line/ok/meh/bad`, `minerals.<id>.label/name`, `shapes.<id>`, `zones.ash/heat/fire`, `facts[4]`, `titles.master/glassblower/apprentice`, `subs.master/…`, `notes.color` („Kolor: chciał {want}, dostał {got}.”), `notes.shape`, `notes.size`, `notes.heat`. Teksty wziąć z prototypu (sekcja „Treści”).

Scena: tło `glass/bg`; `HeatHazeFilter` na tle z `rect` ustawionym na otwór pieca (odczytać z obrazka po wygenerowaniu, zapisać stałą); glow pieca = `Graphics` kółko pomarańczowe z `AdvancedBloomFilter` z `pixi-filters` (alpha pulsuje). Kroki jako osobne `Container`y ze wspólnym API `{ mount(parent), unmount(), update(dt) }`:
- Heat: wskaźnik 3-strefowy (`Graphics`: popiół szary, żar ember, ogień żółty) 900×70, igła (`Graphics`) pozycja = `needlePos(t)`; `Button(heat.btn)`; limit 12 s (po limicie `heatScore(needlePos(t))` bieżącej pozycji).
- Blow: `glass/pipe` od lewej, na końcu bańka = `glass/glob` skalowana do promienia `r` (sprite 768 → r), `targetRing` = `Graphics` okrąg przerywany (rysować 36 łuków); `HoldButton` — hold: `r += BLOW.growPerSec*dt*(1 + r/600)`, `glass.blow` loop podczas holdu; `popped` → `glass.pop`, tekst `blow.pop`, cząsteczki (12 odłamków `Graphics` lecące 0.6 s), reset po 1.1 s; release → `blowScore`; limit 20 s.
- Color: 5 `glass/jar_*` w rzędzie (skala tak, by 180 px wys.), `eventMode static`, tap → `glass.pigment`, 40 cząsteczek w kolorze `tint` lecą ze słoika do bańki (0.5 s), bańka `tint = mineral.tint`; limit 15 s (brak wyboru → losowy zły).
- Shape: 5 `glass/shape_*` (białe, `tint` = wybrany) 200 px, tap → `glass.mold` + `glass/mold` zamyka się (dwa sprite'y zjeżdżają) + squash bańki → wybrane naczynie pojawia się na stole (`scale` 0→1 easeOutBack); limit 15 s.
- Result: `SpeechBubble` z portretem `glass/portrait_<id>` i reakcją, naczynie z `GlowFilter` (pixi-filters) w kolorze tintu, `Stars.set`, notatki, `FactCard(ui.didYouKnow, facts[i])`, `Button(next|finish)`.
Podsumowanie: `sum.h`, 9 gwiazdek, tytuł, 3 naczynia na stole, `again` (reset), `ui.back`. Muzyka `glass.music` 0.45 + `glass.furnace` 0.35 loop.

Commit: `feat(glass): Hutnik z Józefiny`.

### Task 7: Liczyrzepa i księżniczka Emma — `games/turnips`

**Files:** `src/games/turnips/rules.ts`, `rules.test.ts`, `pl.json`, `TurnipsScene.ts`

`rules.ts`:

```ts
export type Weather = 0 | 1 | 2 | 3 | 4; // none, fog, rain, snow, sun
export interface Wave { round: number; count: number; decoys: number; showMs: number; gapMs: number; weather: Weather; groups: number }
export function roundConfig(round: number): Wave {
  const table: Omit<Wave, 'round'>[] = [
    { count: 4, decoys: 0, showMs: 1800, gapMs: 500, weather: 0, groups: 2 },
    { count: 6, decoys: 1, showMs: 1500, gapMs: 450, weather: 4, groups: 3 },
    { count: 8, decoys: 2, showMs: 1300, gapMs: 400, weather: 1, groups: 3 },
    { count: 11, decoys: 3, showMs: 1100, gapMs: 350, weather: 2, groups: 4 },
    { count: 14, decoys: 4, showMs: 900, gapMs: 300, weather: 3, groups: 4 },
  ]; return { round, ...table[Math.min(Math.max(round, 1), 5) - 1] };
}
export function splitIntoGroups(rng: () => number, count: number, groups: number): number[]; // suma == count, każdy ≥ 1
export function answerOptions(rng: () => number, correct: number): number[]; // 4 unikalne ≥ 0, zawiera correct, pozostałe z [correct-3, correct+3]\{correct}, potasowane
export function fieldSlots(cols = 6, rows = 3): { x: number; y: number }[]; // siatka w obszarze pola: x 260..1660, y 620..960, lekki zygzak co drugi rząd
export function starsFor(correctRounds: number, total = 5): 1 | 2 | 3 { return correctRounds >= total ? 3 : correctRounds >= 3 ? 2 : 1; }
```

Testy: `roundConfig(1).count===4`, `roundConfig(9).count===14`, `splitIntoGroups` suma i min 1 dla 100 losowań, `answerOptions` 4 unikalne i zawiera correct i wszystkie ≥ 0 (także dla correct=0..2), `fieldSlots()` ma 18 unikalnych pozycji, `starsFor(5)===3`, `starsFor(2)===1`.

Scena: tło `turnips/bg` z `WeatherFilter` (mode z `Wave.weather`, intensity 0.7; przejście 1 s). Emma (`turnips/emma_1/2`, przełączanie klatek co 0.15 s podczas biegu) na ścieżce w 6 punktach od lewego dołu do prawej góry (x 200→1500, y 560→380), przesuwa się o jeden po każdej rundzie z `turnips.steps`. Duch Gór: `glass/portrait_duch` w `SpeechBubble` na intro i podsumowaniu. Runda: `fieldSlots()` → `turnips/mound` na każdym; grupy rzep: wybrane sloty (bez powtórek, `decoys` dostają `turnips/stone` zamiast rzepy) — rzepa wyjeżdża z kopczyka (maska prostokątna na kopczyk: `turnip.y` z +180 do 0 w 0.25 s easeOutBack, `turnips.pop`), stoi `showMs`, chowa się; po ostatniej grupie 4 kafelki (`Button` 200×120 z liczbą, Fraunces 64) z `answerOptions`; trafienie → `turnips.correct` + `Stars` błysk; chybienie → `turnips.wrong`, pokazanie poprawnej liczby i wszystkich rzep przez 1.2 s; limit odpowiedzi 8 s. `turnips.thunder` przy pogodzie 2. Podsumowanie: Emma znika za krawędzią, `turnips.grumble`, Duch Gór mówi `sum.line`, `Stars`, tytuł (`titles.<n>` dla 5/3-4/≤2), `FactCard`. Muzyka `turnips.music` 0.4 + `turnips.wind` 0.3.

`pl.json` (`turnips`): `title`, `intro.h/p/start`, `round.h` („Policz rzepy”), `round.q` („Ile rzep wyskoczyło?”), `round.correct`, `round.wrong` („Było {n}”), `sum.h`, `sum.line`, `titles.3/2/1`, `facts[5]` (Rübezahl/Krakonoš/Liczyrzepa i etymologia; kaplica św. Wawrzyńca 1681; Śnieżka 1603 m najwyższy szczyt Sudetów; obserwatorium „spodki” 1974; granica polsko-czeska biegnie grzbietem).

Commit: `feat(turnips): Liczyrzepa i księżniczka Emma`.

### Task 8: Sztolnia — `games/mine`

**Files:** `src/games/mine/rules.ts`, `rules.test.ts`, `pl.json`, `MineScene.ts`

`rules.ts`:

```ts
export type OreType = 'iron' | 'uranium';
export interface Vein { id: number; x: number; y: number; type: OreType; hitsLeft: number }
export interface Level { index: 1 | 2 | 3; bg: 'mine/bg_1' | 'mine/bg_2' | 'mine/bg_3'; oilSeconds: number; veins: Vein[]; drips: { x: number; periodS: number }[]; bats: number; lampRadius: number }
export const HITS = 3;
export function levelConfig(index: 1 | 2 | 3, rng: () => number): Level;
// L1: 5 żył iron, oil 60, lampRadius 0.22 (uv), 2 krople, 0 nietoperzy; L2: 4 iron + 2 uranium, oil 55, r 0.2, 3 krople, 1 nietoperz; L3: 2 iron + 5 uranium, oil 50, r 0.18, 4 krople, 2 nietoperze.
// pozycje żył: losowe w obszarze x 200..1720, y 300..980, min. odległość 220 px między żyłami (odrzucanie, max 500 prób)
export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number;
export function isLit(lamp: { x: number; y: number }, p: { x: number; y: number }, radiusPx: number): boolean { return dist(lamp, p) <= radiusPx; }
export function geigerLevel(lamp: { x: number; y: number }, veins: Vein[]): 0 | 1 | 2 | 3; // najbliższa żyła uranium z hitsLeft>0: d<160→3, <360→2, <640→1, inaczej 0
export function hit(vein: Vein): Vein { return { ...vein, hitsLeft: Math.max(0, vein.hitsLeft - 1) }; }
export function minedCount(veins: Vein[]): number;
export function starsFor(mined: number, total: number): 1 | 2 | 3 { const f = mined / total; return f >= 1 ? 3 : f >= 0.6 ? 2 : 1; }
```

Testy: `levelConfig(3, rng).veins.filter(v=>v.type==='uranium').length===5`, odległości między żyłami ≥ 220, `geigerLevel` progi, `hit` nie schodzi poniżej 0, `starsFor(5,5)===3`, `starsFor(3,5)===2`, `starsFor(1,5)===1`.

Scena: `mine/bg_<n>` w kontenerze `world` z `LampLightFilter` (ambient 0.06, radius = `lampRadius`, flicker 0.15; `light` = pozycja lampy w uv = `(lamp.x/1920, lamp.y/1080)`); żyły `mine/vein_*` (skala 0.5) w `world` (więc też pod filtrem) — widać je tylko w świetle; uranium dodatkowo `GlowFilter` zielony o alfie = `isLit ? 0.8 : 0`. Lampa `mine/lamp` (wys. 160) podąża za palcem: `pointermove` na całej scenie, przeciąganie przenosi lampę (lerp 12/s); tap na żyle w świetle → `mine.pick`, `hit`, iskry (10 cząsteczek), wstrząs kamery ±4 px 0.1 s; `hitsLeft===0` → żyła znika z pyknięciem, licznik `{mined}/{total}` w TopBar subtitle. Geiger: `mine.geigerSlow` loop vol 0.4 przy poziomie 1–2 (rate 1.0/1.4), `mine.geigerFast` przy 3; ikona `mine/geiger` 120 px w prawym dolnym rogu z drgającą igłą. Krople: co `periodS` kropla `Graphics` spada z góry na x; trafienie w lampę (|dx|<60 w chwili dotarcia do `lamp.y`) → `ambient` 0.02 i `radius` ×0.3 na 1.2 s. Nietoperz: `mine/bat` przelatuje co 15–20 s (sin po y), zderzenie z lampą → `mine.bat`, lampa odskakuje o 220 px w losową stronę. Olej: pasek 600×18 w TopBar (ember → bad), `oilSeconds` od wejścia; 0 → `mine.rumble`, ciemność 1 s, koniec poziomu. Koniec poziomu (wszystko wykute lub olej) → `mine.bell`, `mine/cart` wjeżdża z lewej z wykutymi bryłkami, `Stars.set(starsFor)`, `FactCard`, `next`. 3 poziomy; podsumowanie: suma gwiazdek (max 9), tytuł. Muzyka `mine.music` 0.35 + `mine.drip` 0.3.

`pl.json` (`mine`): `title`, `intro.h/p/start`, `levels[3].name/year/h` („Sztolnia z XII wieku”, „Sztolnia z XIX wieku”, „Sztolnia R-1, rok 1948”), `hud.oil`, `hud.mined` („Wykute: {m} z {n}”), `level.done`, `level.dark` („Lampa zgasła”), `sum.h`, `titles.3/2/1`, `facts[4]` (Laurentius Angel 1148 i nazwa od kowali; dywany od 1854; uran 1948–1963, Zakłady R-1; Sztolnie Kowary trasa turystyczna).

Commit: `feat(mine): Sztolnia`.

### Task 9: Laborant — `games/herbs`

**Files:** `src/games/herbs/rules.ts`, `rules.test.ts`, `pl.json`, `HerbsScene.ts`

`rules.ts`:

```ts
export type PlantId = 'arnika' | 'goryczka' | 'dziewieciesil' | 'podbial' | 'pierwiosnek' | 'prawoslaz' | 'piolun' | 'mieta' | 'muchomor' | 'pokrzywa';
export const HERBS: PlantId[] = ['arnika', 'goryczka', 'dziewieciesil', 'podbial', 'pierwiosnek', 'prawoslaz', 'piolun', 'mieta'];
export const DECOYS: PlantId[] = ['muchomor', 'pokrzywa'];
export interface Recipe { id: 'kaszel' | 'stluczenia' | 'zoladek'; herbs: PlantId[] }
export const RECIPES: Recipe[] = [ { id: 'kaszel', herbs: ['podbial', 'pierwiosnek', 'prawoslaz'] }, { id: 'stluczenia', herbs: ['arnika', 'dziewieciesil'] }, { id: 'zoladek', herbs: ['goryczka', 'piolun', 'mieta'] } ];
export interface Spawn { t: number; plant: PlantId; lane: 0 | 1 | 2 } // t: sekundy od startu rundy, lane: 3 pasy przy ścieżce (y 700/800/900)
export function spawnPlan(rng: () => number, recipe: Recipe, seconds = 40): Spawn[];
// co 1.6–2.4 s jeden spawn; każde zioło z recepty pojawia się ≥ 2 razy; 30% spawnów to inne HERBS, 20% DECOYS; pierwsze 2 s bez wabików
export type PickResult = 'needed' | 'duplicate' | 'wrong' | 'decoy';
export function pickResult(basket: PlantId[], plant: PlantId, recipe: Recipe): PickResult;
export function basketComplete(basket: PlantId[], recipe: Recipe): boolean;
export function purity(picks: PickResult[]): number; // needed / (needed + wrong + decoy), 1 gdy brak picks
export function grindProgress(angleDeltaRad: number, current: number): number; // current + |delta|/(2π*4), max 1 → 4 pełne obroty
export function starsFor(purity: number, grindSeconds: number): 1 | 2 | 3; // purity ≥ .9 && grind ≤ 8 → 3; purity ≥ .6 → 2; else 1
```

Testy: `spawnPlan` zawiera każde zioło recepty ≥ 2×, pierwsze spawny do t<2 nie są wabikami, `t` rosnące; `pickResult([], 'arnika', stluczenia)==='needed'`, `pickResult(['arnika'], 'arnika', …)==='duplicate'`, `pickResult([], 'mieta', stluczenia)==='wrong'`, `pickResult([], 'muchomor', …)==='decoy'`; `purity(['needed','needed','wrong'])` ≈ .667; `grindProgress(2*Math.PI, 0)===0.25`; `starsFor(1, 5)===3`, `starsFor(.7, 20)===2`, `starsFor(.3, 5)===1`.

Scena: `herbs/bg_far` statyczne; `herbs/strip_mid` ×2 (tiling z odbiciem lustrzanym co drugi segment: `scale.x = -1`) przewija 60 px/s; `herbs/strip_near` ×2 przewija 140 px/s; Laborant (`herbs/laborant_1/2`, klatki co 0.3 s, wys. 420) stoi w x=420, y=760 (bob ±6 px). Recepta: panel u góry pod TopBar z miniaturami roślin (`herbs/plant_*` 90 px) i ptaszkami po zebraniu. Rośliny ze `spawnPlan` wjeżdżają z prawej (x 2000 → −200 w 14 s) na swoim pasie, `eventMode static`, hit-area 160×200; tap → `herbs.pluck`, roślina leci do koszyka (`herbs/basket` przy Laborancie, 0.4 s, tween po łuku); `wrong`/`decoy` → `herbs.sneeze`, czerwony błysk ekranu 0.2 s, Laborant podskakuje; `duplicate` → bez kary, roślina do koszyka (ale nie liczy się). Gdy `basketComplete` → faza moździerza: `herbs/mortar` (420 px) na środku, `herbs/pestle` jako uchwyt; gracz przeciąga po okręgu: kąt = `atan2` względem środka moździerza, `grindProgress` z deltą kąta; `herbs.grind` loop podczas ruchu; pierścień postępu (`Graphics` arc); po 1.0 → `herbs.pour`: zielony płyn wlewa się do `glass/shape_flakon` z `tint` 0x7d4fa3; `Stars.set(starsFor(purity, grindSeconds))`, `FactCard`, `next`. Limit zbierania 40 s (po nim moździerz z tym, co jest; brakujące zioła = purity liczona jak wyżej, ale `starsFor` dostaje purity×(zebrane/wymagane)). 3 recepty w losowej kolejności. Muzyka `herbs.music` 0.4 + `herbs.birds` 0.3 + `herbs.steps` 0.25 podczas marszu.

`pl.json` (`herbs`): `title`, `intro.h/p/start`, `recipes.<id>.name/line` („Na kaszel dla dzieci z Miłkowa: podbiał, pierwiosnek, prawoślaz”), `plants.<id>` (polskie nazwy), `grind.h/p` („Utrzyj zioła”, „Krąż palcem po moździerzu”), `round.done`, `sum.h`, `titles.3/2/1`, `facts[4]` (laboranci XVII–XIX w.; zakaz w 1843 i ostatni laborant Zölfel † 1884; „dziewięćsił” od dziewięciu sił; sprzedawali leki na jarmarkach w całych Prusach).

Commit: `feat(herbs): Laborant`.

---

## Fala 4 (po merge'u fali 3): Task 10–12

### Task 10: Integracja i scalanie

- Merge gałęzi fali 3 do `main` (kolejność: hub, glass, turnips, mine, herbs); konflikty tylko w `pl.json`/`index.ts` — rozwiązać ręcznie.
- `pnpm test && pnpm build`; `pnpm dev` i przejście każdej gry myszą od hubu i z `#gra=<place>`; `?kiosk=1` → po 60 s w grze wraca do hubu.
- Zmierz: rozmiar `dist/` i `public/assets` (≤ 40 MB + 10 MB), czas do pierwszego kadru hubu na localhost w Chrome (cel < 3 s).
- Commit: `chore: integrate wave 3`.

### Task 11: Smoke testy Playwright

**Files:** `tools/smoke/playwright.config.ts`, `tools/smoke/smoke.spec.ts`, `package.json` (`"smoke": "playwright test -c tools/smoke"`), `pnpm add -D @playwright/test && pnpm exec playwright install chromium`.

Testy (1280×800 i 390×844): hub ładuje się bez błędów konsoli (nasłuch `page.on('console')`, `pageerror` → fail); kliknięcie w marker Szklarskiej (współrzędne z `pl.json` przeliczone przez `fitScale`) otwiera grę (tytuł w canvas nie do odczytu → sprawdzać `window.__bk.sceneId` wystawiane przez `SceneManager` w trybie dev); przejście Hutnika stukając w przyciski przez `page.mouse` z użyciem `window.__bk.hit('glass.heat.btn')` — każdy `Button` rejestruje się pod `name` w globalnym rejestrze dev (`Button` dostaje opcjonalne `name`), a `__bk.hit(name)` zwraca środek w px ekranu; `#gra=kowary` otwiera Sztolnię; `#gra=xyz` otwiera hub; przy 390×844 widoczny `#rotate`. Zrzuty do `docs/screenshots/`.

Commit: `test(smoke): playwright hub + glass walkthrough`.

### Task 12: README, przegląd, porządki

- `README.md`: co to jest, jak uruchomić (`pnpm i && pnpm fonts && pnpm dev`), jak generować assety (`tools/assets/README.md`), routing (`#gra=`, `?kiosk=1`), struktura, licencje fontów (OFL).
- Przegląd spec vs build: tabela 17 miejsc (marker, karta), 4 gry (rundy, limity, gwiazdki, fakty), kiosk, routing, fallbacki — każdy wiersz z dowodem (test lub zrzut).
- Commit: `docs: README and spec audit`.

---

## Treści (do przepisania 1:1 do JSON)

Karty 17 miejsc: teksty `lore` i `mech` z prototypu w artefakcie (https://claude.ai/artifact/Mc2ujD7bJyzmtXSQ8p4EbP, sekcja „Katalog miejsc i mini gier”) — przepisać bez zmian; `x,y` wstępnie = współrzędne SVG × 1.6 (y + 188), do kalibracji w Task 5 po obejrzeniu wygenerowanego tła.

Hutnik — klienci (name / line / ok / meh / bad):
- hrabina: „Hrabina Schaffgotsch” / „Na bal w Cieplicach potrzebuję dużego rubinowego pucharu.” / „Doskonale. Będzie stał na honorowym miejscu.” / „Hm. Ujdzie, jeśli nikt nie przyjrzy się z bliska.” / „To nie jest to, o co prosiłam.”
- walon: „Walon z Izerów” / „Małą butelkę na wodę ze źródła. Zieloną jak las, żeby nikt nie zauważył.” / „Znikam z nią w gęstwinie. Dziękuję, hutniku.” / „Trochę widać pod światło, ale wezmę.” / „Z tym mnie każdy wypatrzy na milę.”
- laborant: „Laborant z Karpacza” / „Mały fioletowy flakon na nalewkę z dziewięćsiłu. Fiolet chroni zioła przed słońcem.” / „Nalewka przetrwa w nim zimę. Pięknie.” / „Pomieści, ale słońce trochę przejdzie.” / „W tym zioła zwietrzeją w tydzień.”
- duch: „Duch Gór” / „Dużą kulę, niebieską jak niebo nad Śnieżką. I nie nazywaj mnie Liczyrzepą.” / „Postawię ją na szczycie, niech się chmury przeglądają.” / „Niebo nad Śnieżką bywa i takie. Biorę.” / „Grzmot! Tak wygląda niebo? Chyba nad Kowarami.”
- pohl: „Mistrz Franz Pohl” / „Zanim wrócę: zrób duży wazon ze szkła uranowego. Ma świecić jak latarnia.” / „Świeci! Z Ciebie będzie prawdziwy hutnik.” / „Nieźle, ale jeszcze poćwiczysz przy piecu.” / „Wracaj do pieca, czeladniku.”
Minerały: kobalt→„błękit”, żelazo→„leśna zieleń”, złoto→„rubin”, mangan→„fiolet”, uran→„uranowa zieleń”. Fakty Hutnika: 4 z prototypu. Intro: „Witaj w hucie Józefina” / „Jest rok 1842. Mistrz Pohl wyjechał do Cieplic, a przed hutą stoi kolejka klientów. Zrób trzy naczynia. Każde zamówienie to cztery ruchy: rozgrzej, dmuchnij, zabarw, uformuj.” Tytuły: „Mistrz huty” / „Hutnik” / „Czeladnik” z podpisami z prototypu.

Liczyrzepa — intro: „Policz, Duchu Gór” / „Porwałeś na Śnieżkę księżniczkę Emmę. Obiecała zostać, jeśli policzysz wszystkie rzepy na polu. Licz uważnie: rzepy wyskakują i chowają się, a pogoda na szczycie zmienia się co chwilę.” Podsumowanie: „Emma uciekła w dolinę” / Duch: „Liczyłem uczciwie! I nie nazywajcie mnie Liczyrzepą.” Tytuły: „Rachmistrz Gór” / „Duch z głową do liczb” / „Rozkojarzony olbrzym”.

Sztolnia — intro: „Zjazd na dół” / „Dostajesz lampę, kilof i jedną zmianę. Przeciągaj lampę po ścianie, szukaj żył rudy i wykuwaj je trzema uderzeniami. Uważaj na kapiącą wodę, a gdy licznik zacznie trzeszczeć, jesteś blisko uranu.” Tytuły: „Sztygar” / „Górnik” / „Praktykant”.

Laborant — intro: „Dzień laboranta” / „Słońce wstaje nad Karpaczem. Masz trzy recepty i zbocze pełne ziół. Stukaj tylko w te rośliny, które są na recepcie. Potem utrzyj je w moździerzu i zlej do flakonu.” Tytuły: „Mistrz laborant” / „Zielarz” / „Pomocnik”.
