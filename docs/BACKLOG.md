# Backlog

Autonomous mode: every item is one thread and one PR against `integration`; tick it here when it merges.
Reuben reviews `integration` against real data and fast-forwards `main`.

HUD screens: register through `registerHudScreen` (src/ui/hudRegistry.ts); the built-in screens live in src/ui/builtinScreens.ts. Keep src/game/main.ts to one import plus one call per feature.

- [x] 0 HUD screen registry refactor and this file
- [x] 1 Shops and haggling: buy/sell at town shop hotspots with OBJINFO prices, Haggling skill, shop inventories
- [x] 2 Inns: rest and heal, rations and drinks, time passing
- [x] 3 Temples: healing, curing conditions, blessings, temple teleport network
- [x] 4 Camping in the wild: R key rest/sleep, healing, rations, time, interruptions
- [x] 5 Using items: eat, drink, scrolls, repair, equip/unequip, swap between characters, weight and slot limits
- [x] 6 Chests and containers (OBJFIXED.DAT, tile objects): open, take/put, word-lock riddle chests, traps
- [x] 7 Combat pass 2: crossbows/ranged, enemy AI, loot, experience, wounds
- [x] 8 Skill improvement by practice
- [x] 9 Spells: research data, casting in combat and the world
- [x] 10 Dialogue topics/keywords and remaining dialogue actions
- [x] 11 Sound effects: SX/sound resource format and player
- [x] 12 Cutscene player for ADS/TTM animations
- [x] 13 Chapter transitions and intro screens, per-chapter start state
- [x] 14 Underground mine zones (Z10M-Z12M) with ceilings and lighting
- [x] 15 Main menu: new game, continue, load, options
- [x] 16 Performance: billboard chunk culling (frustum + fog distance), F3 perf overlay (trees were already instanced impostors)
- [x] 17 End-to-end smoke tests in CI with synthetic zone data
- [x] 18 Player README: controls, pointing the game at your own BaK install

Backlog 2:
- [x] 19 Light spells brighten outdoor scenes at night (fading out by day)
- [x] 20 Unify rest models: camping uses the inn rules (`rest.ts`: shared health pool, conditions, near death, 13 hour Sick cure); camping keeps interruptions and party-shared rations
- [x] 21 Note-based sound effects: WebAudio synth for FRP.SX MIDI-style voices
- [x] 22 Cutscene book viewer (.BOK pages for cutscenes and chapter transitions) and music changes during cutscenes
- [x] Inventory and money hand-over between chapters (per-chapter purse, chapter 4 and 5 stash swaps; town containers not yet) (PR #61)

Backlog 3:
- [~] 1 Town containers, chapter 7 flag and expiry steps: machinery and tests merged (`chapterRules.ts`), rule tables empty until the real values are verified (see docs/formats/chapters.md, Open values)
- [x] 2 Real-data checklist for Reuben's review of integration (docs/REAL_DATA_CHECKLIST.md)
- [x] 3 Performance and E2E pass over everything merged (outdoor light spell no longer toggles light count at dawn/dusk, note synth capped at 256 notes, e2e covers light spell and book viewer)

Backlog 4 (from Opus real-data review of integration at 7e8a3b6, 2026-10-07):
- [ ] 1 Books: the illuminated drop cap (e.g. C11.BOK page 1 "B") overlaps the first text line; indent the first lines beside the initial instead of drawing text under it (books.md image placement)
- [ ] 2 `?chapter=N` start position is nondeterministic: chapter 2 landed once in zone 11 at (8, -8) and once in zone 1 at the default spawn. The start-of-chapter teleport races the scene load, and the (8, -8) looks like unscaled tile coordinates. Make the chapter start await the scene and apply the real start position
- [ ] 3 Mine zone 10 at the default `?zone=10` spawn renders fully black (no lantern pool, no geometry visible). Spawn inside the tunnels (zone entry point) and make sure the lantern lights the floor even if the party starts outside
- [ ] 4 Chapter 5 (zone 5) runs at 20 fps vs 60 fps elsewhere on the same GPU (74 sprites, 17k tris): profile with F3 and fix the hot spot
- [x] 5 Startup main menu no longer covers `book`, `cutscene`, `chapter`, `zone` debug starts (fixed on main)

Backlog 5 (from Opus, 2026-10-08; start after open PRs and Backlog 4):
- [ ] 1 Standalone build without the dev server: on first run ask for the BaK folder with the File System Access API (`showDirectoryPicker`, with drag-and-drop / file-input fallback), cache KRONDOR.RMF/.001, STARTUP.GAM and music in OPFS, loading screen with progress; `npm run build` produces a static site that works from any static host; README section
- [ ] 2 Input: gamepad support (move/turn, menus, combat), key rebinding in Options, optional mouse-look in the party view, field-of-view and UI-scale sliders
- [ ] 3 Combat and rules audit against BaKGL: hit chance, damage, armour, wounds, spell costs, skill gains; fix discrepancies; table-driven tests
- [ ] 4 Chapter 1 critical-path e2e test with synthetic data: start, first dialogue, a town, a shop purchase, a combat, a chest, a zone transition, save and load
- [ ] 5 Loading and error screens: zone-load progress, friendly errors for missing/wrong game data, WebGPU-not-available message noting the WebGL2 fallback
- [ ] 6 Code health: ESLint + Prettier in CI, split src/game/main.ts into feature modules (mostly composition), remove dead code and stale probe scripts
- [ ] 7 Journal/notes screen: research BaKGL for a bookmark or quest log; otherwise a simple notes screen of key dialogue lines seen
