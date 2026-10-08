const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto('http://localhost:5174/e2e.html');
    await page.waitForFunction('window.__e2e && window.__e2e.frames > 3', null, { timeout: 10000 });
    
    // teleport to town
    await page.evaluate(() => window.__e2e.teleport(35200, 35200));
    await page.waitForFunction(() => window.__e2e.screen === 'town');
    console.log("In town");

    // Click shop
    const box = await page.locator('canvas').nth(0).boundingBox();
    console.log("Canvas box", box);
    await page.mouse.click(box.x + (35 / 320) * box.width, box.y + (35 / 200) * box.height);
    
    await page.waitForFunction(() => window.__e2e.screen === 'shop', null, { timeout: 5000 });
    console.log("In shop!");

  } catch(e) {
    console.error(e);
  } finally {
    await browser.close();
  }
})();
