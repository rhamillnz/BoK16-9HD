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
