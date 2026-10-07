# Backlog

Autonomous mode: every item is one thread and one PR against `integration`; tick it here when it merges.
Reuben reviews `integration` against real data and fast-forwards `main`.

HUD screens: register through `registerHudScreen` (src/ui/hudRegistry.ts); the built-in screens live in src/ui/builtinScreens.ts. Keep src/game/main.ts to one import plus one call per feature.

- [x] 0 HUD screen registry refactor and this file
- [ ] 1 Shops and haggling: buy/sell at town shop hotspots with OBJINFO prices, Haggling skill, shop inventories
- [ ] 2 Inns: rest and heal, rations and drinks, time passing
- [ ] 3 Temples: healing, curing conditions, blessings, temple teleport network
- [ ] 4 Camping in the wild: R key rest/sleep, healing, rations, time, interruptions
- [ ] 5 Using items: eat, drink, scrolls, repair, equip/unequip, swap between characters, weight and slot limits
- [ ] 6 Chests and containers (OBJFIXED.DAT, tile objects): open, take/put, word-lock riddle chests, traps
- [ ] 7 Combat pass 2: crossbows/ranged, enemy AI, loot, experience, wounds
- [ ] 8 Skill improvement by practice
- [ ] 9 Spells: research data, casting in combat and the world
- [ ] 10 Dialogue topics/keywords and remaining dialogue actions
- [ ] 11 Sound effects: SX/sound resource format and player
- [ ] 12 Cutscene player for ADS/TTM animations
- [ ] 13 Chapter transitions and intro screens, per-chapter start state
- [ ] 14 Underground mine zones (Z10M-Z12M) with ceilings and lighting
- [ ] 15 Main menu: new game, continue, load, options
- [ ] 16 Performance: tree LODs/impostors, culling, perf overlay
- [ ] 17 End-to-end smoke tests in CI with synthetic zone data
- [ ] 18 Player README: controls, pointing the game at your own BaK install
