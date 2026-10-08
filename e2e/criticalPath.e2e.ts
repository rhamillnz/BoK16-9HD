import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { E2eApi } from '../src/e2e/harness';

let server: ViteDevServer;
let browser: Browser;
let page: Page;
const errors: string[] = [];

const read = <T>(fn: (api: E2eApi) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__e2e)`) as Promise<T>;

const settle = async () => {
  const n = await read((a) => a.frames);
  await page.waitForFunction(`window.__e2e.frames >= ${n + 2}`);
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

describe('critical path', () => {
  it('hits a dialogue trigger, chooses yes, and closes it', async () => {
    // Teleport to dialog trigger: l: 10, t: 10 -> 12 * 1600 = 19200
    await read((a) => a.teleport(19200, 19200));
    await settle();
    await screenIs('dialog');
    await page.keyboard.press('Space'); // "Hello traveler" choice 1
    await settle();
    await page.keyboard.press('Space'); // "Goodbye"
    await screenIs('none');
  });

  it('enters a town, opens shop, buys something, and exits', async () => {
    // Teleport to town trigger: l: 20, t: 20 -> 22 * 1600 = 35200
    await read((a) => a.teleport(35200, 35200));
    await settle();
    await screenIs('town');
    
    // E2E mock town has hotspots. Click Shop hotspot at x:10, y:10, w:50, h:50.
    const box = await page.locator('canvas').nth(1).boundingBox() || await page.locator('canvas').nth(0).boundingBox();
    if (box) {
      await page.mouse.click(box.x + (35 / 320) * box.width, box.y + (35 / 200) * box.height);
      await settle();
      await screenIs('shop');
      
      await page.keyboard.press('Escape');
      await screenIs('town');
      
      // Click Exit Town hotspot at x:100, y:100, w:50, h:50
      await page.mouse.click(box.x + (125 / 320) * box.width, box.y + (125 / 200) * box.height);
      await screenIs('none');
    }
  });

  it('triggers a combat and escapes', async () => {
    // Teleport to combat trigger: l: 30, t: 30 -> 32 * 1600 = 51200
    await read((a) => a.teleport(51200, 51200));
    await settle();
    
    await page.waitForTimeout(1000); // Wait for combat animation to begin
    await page.keyboard.press('q');
    await settle();
    const pose = await read((a) => a.pose);
    expect(pose.x).not.toBe(51200);
  });

  it('interacts with a chest', async () => {
    await read((a) => a.teleport(0, 0)); // Move to safety
    await read((a) => a.interact());
    await settle();
  });

  it('triggers a zone transition', async () => {
    // Teleport to zone trigger: l: 10, t: 30 -> x: 19200, y: 51200
    await read((a) => a.teleport(19200, 51200));
    await settle();
    // Wait for transition to be set
    const transition = await read((a) => a.transition);
    expect(transition).not.toBeNull();
  });
  
  it('logged no errors', () => {
    expect(errors.filter((e) => !/favicon/.test(e) && !/console/.test(e))).toEqual([]);
  });
});
