import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';

/**
 * Smoke tests: the hub loads clean, a marker and the QR hashes open the right scene, and the whole
 * Hutnik z Józefiny shift is played through like a player would (pointer on the named buttons).
 *
 * Canvas text cannot be read, so the tests follow the dev hooks: `window.__bk.sceneId` (SceneManager),
 * `window.__bk.buttons[name]()` (centre of a named Button / marker / tile in CSS px) and
 * `window.__bkGlass` (the glass scene's live state). Headless WebGL runs on SwiftShader at a few
 * frames per second and the game clamps dt to 0.1 s, so game time crawls: every wait polls state
 * (per animation frame) or counts game seconds, never wall-clock sleeps.
 */

const SHOTS = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));
const SAVE_KEY = 'bk.save.v1';
/** A scene switch loads a code-split chunk and its asset group, a few frames each. */
const SCENE_TIMEOUT = 90_000;
const STEP_TIMEOUT = 90_000;
/**
 * Frames between a state check in the page and the mouse event it triggers being handled there
 * (measured: ~2 under SwiftShader, at 8 fps and at 3 fps alike). The timed moves aim this far ahead.
 */
const LEAD_FRAMES = 2;

interface Point {
  x: number;
  y: number;
}

/** `window.__bkGlass`, published every frame by GlassScene in dev builds. */
interface GlassDebug {
  step: 'intro' | 'heat' | 'blow' | 'colour' | 'shape' | 'result' | 'summary' | null;
  time: number;
  index: number;
  order: { id: string; shape: string; mineral: string; size: string } | null;
  needle?: number;
  r?: number;
  target?: number;
  pops?: number;
  state?: string;
  frozen?: number;
  stars?: number;
}

/** The dev hooks, for typing the functions that run in the page. */
interface Hooks {
  __bk?: { sceneId: string | null; buttons?: Record<string, () => Point> };
  __bkGlass?: GlassDebug;
  __smokeStill?: Record<string, { x: number; y: number; frames: number } | undefined>;
  /** The previous frame's needle / radius, for the timed moves' lead. */
  __smokeLast?: number;
}

const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '390x844', width: 390, height: 844 },
] as const;

/**
 * Every test fails on a console error, an uncaught page error, an HTTP error status or a failed
 * request. The assets are all in place, so a 404 is a bug too.
 */
const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
      });
      page.on('requestfailed', (r) => problems.push(`request failed (${r.failure()?.errorText}): ${r.url()}`));
      await use(problems);
      expect(problems, 'console errors, page errors or failed requests').toEqual([]);
    },
    { auto: true },
  ],
});

// ------------------------------------------------------------------------------------- helpers

async function open(page: Page, hash = ''): Promise<void> {
  await page.goto(`./${hash}`);
}

async function waitScene(page: Page, id: string): Promise<void> {
  await page.waitForFunction((want) => (window as unknown as Hooks).__bk?.sceneId === want, id, {
    timeout: SCENE_TIMEOUT,
  });
}

async function sceneId(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as Hooks).__bk?.sceneId ?? null);
}

/**
 * Centre (CSS px) of a registered dev target once it has held still for two animation frames, so a
 * button still sliding in is not clicked where it used to be.
 */
async function centre(page: Page, name: string): Promise<Point> {
  const handle = await page.waitForFunction(
    (n) => {
      const w = window as unknown as Hooks;
      const memo = (w.__smokeStill ??= {});
      const p = w.__bk?.buttons?.[n]?.();
      const prev = memo[n];
      if (!p) {
        memo[n] = undefined;
        return null;
      }
      const same = prev !== undefined && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5;
      const frames = same ? prev.frames + 1 : 0;
      memo[n] = { x: p.x, y: p.y, frames };
      return frames >= 2 ? { x: p.x, y: p.y } : null;
    },
    name,
    { polling: 'raf', timeout: STEP_TIMEOUT },
  );
  const p = (await handle.jsonValue()) as Point;
  await page.evaluate((n) => delete (window as unknown as Hooks).__smokeStill?.[n], name);
  return p;
}

async function tap(page: Page, name: string): Promise<void> {
  const p = await centre(page, name);
  await page.mouse.click(p.x, p.y);
}

async function glass(page: Page): Promise<GlassDebug> {
  const g = await page.evaluate(() => (window as unknown as Hooks).__bkGlass ?? null);
  if (!g) throw new Error('window.__bkGlass missing: is this a dev build in the glass scene?');
  return g;
}

/** Waits for the glass scene to show `step` (of order `index`, when given). */
async function glassStep(page: Page, step: GlassDebug['step'], index?: number): Promise<GlassDebug> {
  await page.waitForFunction(
    ([s, i]) => {
      const g = (window as unknown as Hooks).__bkGlass;
      return !!g && g.step === s && (i === null || g.index === i);
    },
    [step, index ?? null] as const,
    { polling: 'raf', timeout: STEP_TIMEOUT },
  );
  return glass(page);
}

/** Lets `seconds` of glass-scene time pass (entrance tweens, pours), however slow the frames are. */
async function glassSeconds(page: Page, seconds: number): Promise<void> {
  const from = (await glass(page)).time;
  await page.waitForFunction(
    (until) => ((window as unknown as Hooks).__bkGlass?.time ?? 0) >= until,
    from + seconds,
    { polling: 'raf', timeout: STEP_TIMEOUT },
  );
}

/**
 * Heat: tap when the needle passes the middle of the ember zone. An input event lands about
 * LEAD_FRAMES frames after the check that sent it, so the check extrapolates the needle that far.
 * The test takes whatever the tap scores (the clock would pick for us after 12 s anyway).
 */
async function playHeat(page: Page, index: number): Promise<string> {
  await glassStep(page, 'heat', index);
  const button = await centre(page, 'glass.heat.btn');
  await page.mouse.move(button.x, button.y);
  await page.evaluate(() => delete (window as unknown as Hooks).__smokeLast);
  await page.waitForFunction(
    (lead) => {
      const w = window as unknown as Hooks;
      const g = w.__bkGlass;
      if (!g || g.step !== 'heat') return true;
      if (g.needle === undefined) return false;
      const prev = w.__smokeLast;
      w.__smokeLast = g.needle;
      if (prev === undefined) return false;
      return Math.abs(g.needle + (g.needle - prev) * lead - 0.5) < 0.1;
    },
    LEAD_FRAMES,
    { polling: 'raf', timeout: STEP_TIMEOUT },
  );
  // already over the button: down / up without another move; the pick lands on pointerdown
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(
    () => {
      const g = (window as unknown as Hooks).__bkGlass;
      return !g || g.step !== 'heat' || g.frozen === 1;
    },
    undefined,
    { polling: 'raf', timeout: STEP_TIMEOUT },
  );
  const g = await glass(page);
  return g.step === 'heat' ? `needle ${g.needle?.toFixed(2)}` : 'needle ?';
}

/**
 * Blow: hold the button until the bubble reaches the dashed ring, then let go. The release lands
 * about LEAD_FRAMES frames after the check (a frame grows the radius by up to ~17 px at the clamped
 * dt), so the check adds that much growth. A burst (1.5 × the ring) or a release that counted as a
 * test tap leaves the step `ready`: blow again. The second burst ends the move by itself.
 */
async function playBlow(page: Page, index: number): Promise<string> {
  await glassStep(page, 'blow', index);
  const button = await centre(page, 'glass.blow.btn');
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForFunction(
      () => {
        const g = (window as unknown as Hooks).__bkGlass;
        return !g || g.step !== 'blow' || g.state === 'ready' || g.state === 'done';
      },
      undefined,
      { polling: 'raf', timeout: STEP_TIMEOUT },
    );
    const g = await glass(page);
    if (g.step !== 'blow' || g.state === 'done') return blowNote(g);

    await page.mouse.move(button.x, button.y);
    await page.evaluate(() => delete (window as unknown as Hooks).__smokeLast);
    await page.mouse.down();
    await page.waitForFunction(
      (lead) => {
        const w = window as unknown as Hooks;
        const g = w.__bkGlass;
        if (!g || g.step !== 'blow') return true;
        if (g.state === 'popped' || g.state === 'closing' || g.state === 'done') return true;
        if (g.r === undefined || g.target === undefined) return false;
        const prev = w.__smokeLast;
        w.__smokeLast = g.r;
        const growth = prev === undefined ? 0 : Math.max(0, g.r - prev);
        return g.r + growth * lead >= g.target;
      },
      LEAD_FRAMES,
      { polling: 'raf', timeout: STEP_TIMEOUT },
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => {
        const g = (window as unknown as Hooks).__bkGlass;
        return !g || g.step !== 'blow' || g.state === 'done' || g.state === 'ready';
      },
      undefined,
      { polling: 'raf', timeout: STEP_TIMEOUT },
    );
    const after = await glass(page);
    if (after.step !== 'blow' || after.state === 'done') return blowNote(after);
  }
  throw new Error('glass blow step did not finish after 4 holds');
}

function blowNote(g: GlassDebug): string {
  return g.step === 'blow' ? `r ${g.r?.toFixed(0)}/${g.target} pops ${g.pops}` : 'r ?';
}

/**
 * One whole order: heat → blow → the ordered colour → the ordered shape → the verdict → next.
 * Returns the stars and a note on the timed moves for the test's annotations.
 */
async function playOrder(page: Page, index: number): Promise<{ stars: number; note: string }> {
  const heat = await playHeat(page, index);
  const blow = await playBlow(page, index);

  const colour = await glassStep(page, 'colour', index);
  await glassSeconds(page, 0.8);
  await tap(page, `glass.jar.${colour.order?.mineral}`);

  const shape = await glassStep(page, 'shape', index);
  await glassSeconds(page, 0.8);
  await tap(page, `glass.shape.${shape.order?.shape}`);

  const result = await glassStep(page, 'result', index);
  await glassSeconds(page, 1.3);
  await tap(page, 'glass.next');
  const stars = result.stars ?? 0;
  return { stars, note: `${result.order?.id}: ${stars} stars (${heat}, ${blow})` };
}

function shot(name: string): string {
  mkdirSync(SHOTS, { recursive: true });
  return `${SHOTS}smoke-${name}.png`;
}

// --------------------------------------------------------------------------------------- tests

for (const vp of VIEWPORTS) {
  const desktop = vp.width > vp.height;

  test.describe(`${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('hub loads without errors', async ({ page }) => {
      await open(page);
      await waitScene(page, 'hub');
      // the markers are up and the panorama has drawn a few frames
      await centre(page, 'hub.szklarska');
      await page.screenshot({ path: shot(desktop ? 'hub' : vp.name) });
    });

    test(`rotate hint is ${desktop ? 'hidden' : 'shown'}`, async ({ page }) => {
      await open(page);
      await waitScene(page, 'hub');
      const rotate = page.locator('#rotate');
      if (desktop) {
        await expect(rotate).toBeHidden();
      } else {
        await expect(rotate).toBeVisible();
        await expect(rotate).not.toBeEmpty();
      }
    });

    test('Szklarska marker opens Hutnik', async ({ page }) => {
      await open(page);
      await waitScene(page, 'hub');
      await tap(page, 'hub.szklarska');
      await waitScene(page, 'game:glass');
    });

    for (const [hash, scene] of [
      ['#kowary', 'game:mine'],
      ['#gra=kowary', 'game:mine'],
      ['#xyz', 'hub'],
      ['#gra=xyz', 'hub'],
    ] as const) {
      test(`${hash} opens ${scene}`, async ({ page }) => {
        await open(page, hash);
        await waitScene(page, scene);
        // the route decides the first scene; nothing bounces it elsewhere afterwards
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        expect(await sceneId(page)).toBe(scene);
      });
    }

    test('Hutnik play-through ends back on the hub with a save', async ({ page }) => {
      // ~65 s of game time; at 2–4 fps (dt clamped to 0.1 s) that is several real minutes
      test.slow();
      await open(page);
      await waitScene(page, 'hub');
      await tap(page, 'hub.szklarska');
      await waitScene(page, 'game:glass');

      await glassStep(page, 'intro');
      const clock = { wall: Date.now(), game: (await glass(page)).time };
      await glassSeconds(page, 0.8);
      await tap(page, 'glass.start');

      for (let i = 0; i < 3; i++) {
        const { stars, note } = await playOrder(page, i);
        test.info().annotations.push({ type: 'order', description: note });
        expect(stars).toBeGreaterThanOrEqual(1);
      }
      // how slowly the game ran here (dt is clamped to 0.1 s, so below 10 fps game time lags)
      const game = (await glass(page)).time - clock.game;
      const wall = (Date.now() - clock.wall) / 1000;
      test.info().annotations.push({ type: 'pace', description: `${game.toFixed(1)} game s in ${wall.toFixed(1)} s` });

      await glassStep(page, 'summary');
      const save = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
      expect(save).toContain('"glass"');
      // the stars, title and buttons have finished coming in
      await glassSeconds(page, 2.5);
      if (desktop) await page.screenshot({ path: shot('glass-summary') });

      await tap(page, 'glass.back');
      await waitScene(page, 'hub');
      const saved = JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)) ?? 'null');
      expect(saved?.games?.glass?.stars).toBeGreaterThanOrEqual(1);
    });
  });
}
