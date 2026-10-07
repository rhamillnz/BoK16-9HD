# End-to-end smoke tests

`npm run test:e2e` starts the Vite dev server, opens `e2e.html` in headless Chromium (Playwright) and drives it with the keyboard. The page (`src/e2e/harness.ts`) runs the real stage, sky, zone scene builder, party controller, HUD and save controls, but feeds them synthetic data from `src/e2e/syntheticData.ts` (one flat tile with a block and three tree sprites, a block font, a two-character save). No original game files are needed, so it runs in CI.

What it covers (`e2e/smoke.e2e.ts`): boot and rendering, walking and turning, the I / C / Tab / F6 HUD screens (and that they block movement), F5/F9 quick save and load, and loading from the F6 slot screen. It also fails on any page error or console error.

Notes:
- CI has no GPU. WebGPU is absent, so three.js falls back to WebGL2 (SwiftShader). The test only checks the backend is one of the two.
- Software rendering is slow, so tests wait for the party to *move a distance* rather than holding a key for a fixed time.
- The harness exposes `window.__e2e` (pose, open screen, gold, frame count) for assertions. Extend the harness, not `main.ts`, when a new feature needs smoke coverage.
- Locally, point `CHROMIUM` at a Chromium binary, or run `npx playwright-core install chromium` once.
- `npx vitest run` does not pick these up (they are `*.e2e.ts`).
