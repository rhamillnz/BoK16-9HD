const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:5174/e2e.html');
    await page.waitForFunction('window.__e2e && window.__e2e.frames > 3', null, { timeout: 10000 });
    const encounters = await page.evaluate(() => {
      if (window.__e2e && window.__e2e.debugEncounters) {
        return window.__e2e.debugEncounters();
      }
      return null;
    });
    console.log("Encounters from debugEncounters():");
    console.dir(encounters, { depth: null });
    
    // Also test if teleporting triggers it? 
    // First, let's just dump encounters.
  } catch(e) {
    console.error(e);
  } finally {
    await browser.close();
  }
})();
