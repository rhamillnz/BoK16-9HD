// Frame-time profile of a view without the vsync cap: prints the F3 overlay (fps, ms, shadow casters) after 9 s.
// Usage: node scripts/profile-view.mjs "http://localhost:5176/game.html?zone=1&x=655000&y=918000&h=192" [shot.png]
import { chromium } from 'playwright-core';
const [url, out] = process.argv.slice(2);
const exe = process.env.LOCALAPPDATA + '/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const b = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
  ],
});
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.goto(url);
await p
  .waitForFunction(() => /fps/.test(document.getElementById('hud')?.textContent ?? ''), null, { timeout: 60000 })
  .catch(() => {});
await p.waitForTimeout(6000);
await p.keyboard.press('F3');
await p.waitForTimeout(3000);
const txt = await p.evaluate(() => [...document.querySelectorAll('pre')].map((e) => e.textContent).join('\n'));
console.log(txt);
if (out) await p.screenshot({ path: out });
await b.close();
