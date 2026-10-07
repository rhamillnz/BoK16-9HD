import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { E2eApi } from '../src/e2e/harness';

/**
 * Boots the harness page (real renderer, zone scene, HUD and save controls over synthetic data)
 * in headless Chromium. CI has no GPU, so WebGPU is absent and three.js falls back to WebGL2
 * on SwiftShader; that is the backend these tests exercise.
 */

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const errors: string[] = [];

const read = <T>(fn: (api: E2eApi) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__e2e)`) as Promise<T>;

/** Hold a key until the party has moved `distance` game units from where it was (frame rate on software GL is low). */
const walk = async (key: string, distance: number) => {
  const from = await read((a) => a.pose);
  await page.keyboard.down(key);
  await page.waitForFunction(`Math.hypot(window.__e2e.pose.x - ${from.x}, window.__e2e.pose.y - ${from.y}) >= ${distance}`);
  await page.keyboard.up(key);
  await settle();
};

/** Let two frames pass so a key release has been seen by the game loop. */
const settle = async () => {
  const n = await read((a) => a.frames);
  await page.waitForFunction(`window.__e2e.frames >= ${n + 2}`);
};

const hold = async (key: string, ms: number) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

const screenIs = (name: string) => page.waitForFunction(`window.__e2e.screen === ${JSON.stringify(name)}`);

beforeAll(async () => {
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()} ${m.location().url}`));
  await page.goto(`${url}e2e.html`);
  await page.waitForFunction('window.__e2e && window.__e2e.frames > 3', null, { timeout: 90_000 });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('smoke', () => {
  it('boots, renders frames and builds the synthetic zone', async () => {
    const info = await read((a) => ({ backend: a.backend, stats: a.stats, frames: a.frames }));
    expect(info.backend).toMatch(/WebGPU|WebGL2/);
    expect(info.stats.meshItems).toBeGreaterThan(0);
    expect(info.stats.sprites).toBe(3);
    expect(await page.locator('canvas').count()).toBeGreaterThanOrEqual(2); // 3D stage + HUD overlay
    // Something other than a blank frame: the stage canvas has visible pixels.
    const lit = await page.evaluate(() => {
      const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
      return c.width > 0 && c.height > 0;
    });
    expect(lit).toBe(true);
  });

  it('walks forward and turns with the keyboard', async () => {
    const before = await read((a) => a.pose);
    await walk('KeyW', 60);
    const after = await read((a) => a.pose);
    // Heading 0 faces north (+y in game units).
    expect(after.y).toBeGreaterThan(before.y + 50);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(`window.__e2e.pose.heading !== ${after.heading}`);
    await page.keyboard.up('ArrowRight');
    await settle();
  });

  it('opens and closes the main HUD screens', async () => {
    for (const [key, screen] of [['KeyI', 'inventory'], ['KeyC', 'sheet'], ['Tab', 'map'], ['F6', 'saves']] as const) {
      await page.keyboard.press(key);
      await screenIs(screen);
      // Movement is blocked while a screen is open.
      const p = await read((a) => a.pose);
      await hold('KeyW', 200);
      await settle();
      const q = await read((a) => a.pose);
      expect([q.x, q.y]).toEqual([p.x, p.y]);
      await page.keyboard.press('Escape');
      await screenIs('none');
    }
  });

  it('quick-saves and quick-loads: position and party state come back', async () => {
    const saved = await read((a) => a.pose);
    await page.keyboard.press('F5');
    await page.waitForFunction('window.__e2e.quickSaved()');
    await walk('KeyW', 60);
    await read((a) => a.setGold(1));
    expect((await read((a) => a.pose)).y).toBeGreaterThan(saved.y + 50);
    expect(await read((a) => a.gold)).toBe(1);

    await page.keyboard.press('F9');
    await page.waitForFunction('window.__e2e.gold === 500'); // the load restored the party
    const loaded = await read((a) => a.pose);
    expect(loaded.x).toBeCloseTo(saved.x, 3);
    expect(loaded.y).toBeCloseTo(saved.y, 3);
    expect(loaded.heading).toBeCloseTo(saved.heading, 3);
    expect(await read((a) => a.gold)).toBe(500);
  });

  it('loads a save from the F6 slot screen', async () => {
    await walk('KeyW', 60);
    const moved = await read((a) => a.pose);
    await page.keyboard.press('F6');
    await screenIs('saves');
    await page.keyboard.press('KeyL'); // Load tab
    await page.keyboard.press('Enter'); // the quick slot is first
    await screenIs('none'); // a successful load closes the screen by itself
    expect((await read((a) => a.pose)).y).toBeLessThan(moved.y - 50);
  });

  it('shows the light spell glow outdoors at night and not by day', async () => {
    await read((a) => a.setMinutes(0)); // midnight
    await read((a) => a.setMagicLight(true));
    await settle();
    const night = await read((a) => a.lights);
    expect(night.visible).toBe(1);
    expect(night.intensity).toBeGreaterThan(0);
    await read((a) => a.setMinutes(12 * 60)); // noon: the light stays registered but gives nothing
    await settle();
    const noon = await read((a) => a.lights);
    expect(noon.visible).toBe(night.visible); // no light-count change, so no shader recompile at dawn
    expect(noon.intensity).toBe(0);
    await read((a) => a.setMagicLight(false));
    await settle();
    expect((await read((a) => a.lights)).visible).toBe(0);
  });

  it('plays a book: pages turn with Space and Escape skips', async () => {
    await read((a) => a.openBook());
    await screenIs('book');
    expect(await read((a) => a.bookSpreads)).toBeGreaterThan(0);
    // Movement is blocked while the book is open.
    const p = await read((a) => a.pose);
    await hold('KeyW', 200);
    await settle();
    expect(await read((a) => [a.pose.x, a.pose.y])).toEqual([p.x, p.y]);
    const spreads = await read((a) => a.bookSpreads);
    for (let i = 0; i < spreads; i++) await page.keyboard.press('Space');
    await screenIs('none'); // the last page finishes the book
    expect(await read((a) => a.bookDone)).toBe(1);

    await read((a) => a.openBook());
    await screenIs('book');
    await page.keyboard.press('Escape');
    await screenIs('none');
    expect(await read((a) => a.bookDone)).toBe(2);
  });

  it('logged no errors', () => {
    expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
  });
});
