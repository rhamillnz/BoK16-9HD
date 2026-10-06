// Screenshot the running dev server with Playwright's Chromium on the real GPU (WebGPU).
// Usage: node scripts/shoot.mjs <out.png> [url] [keys...]
//   keys: e.g. "ArrowUp*20" holds/presses a key N times, "wait:1000" pauses, "F" toggles fly cam.
import { chromium } from 'playwright-core';

const [out, url = 'http://localhost:5173/game.html', ...steps] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/shoot.mjs <out.png> [url] [keys...]');
  process.exit(1);
}
const exe = process.env.CHROMIUM ?? `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe`;
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => /fps/.test(document.getElementById('hud')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => {});
for (const step of steps) {
  if (step.startsWith('wait:')) await page.waitForTimeout(Number(step.slice(5)));
  else if (step.startsWith('hold:')) {
    const [key, ms] = step.slice(5).split('*');
    await page.keyboard.down(key);
    await page.waitForTimeout(Number(ms ?? 500));
    await page.keyboard.up(key);
  } else {
    const [key, n] = step.split('*');
    for (let i = 0; i < Number(n ?? 1); i++) await page.keyboard.press(key);
  }
}
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log('HUD:', (await page.textContent('#hud'))?.replace(/\n/g, ' | '));
const interesting = logs.filter((l) => !l.includes('[vite]') && !l.includes('favicon'));
if (interesting.length) console.log(interesting.slice(0, 10).join('\n'));
await browser.close();
