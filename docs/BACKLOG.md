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
- [x] 23 Enemies casting spells: monsters with Casting skill cast damage and healing spells in combat (PR #60)
- [x] Inventory and money hand-over between chapters (per-chapter purse, chapter 4 and 5 stash swaps; town containers not yet) (PR #61)
- [x] Overhead mine models (ZxxM.TBL) drawn on the Tab map in mines (PR #59)

Backlog 3:
- [x] 1 (Opus 2026-10-14: values from BaKGL, town container hotspots open, see docs/formats/chapters.md) Town containers, chapter 7 flag and expiry steps: machinery and tests merged (`chapterRules.ts`), rule tables empty until the real values are verified (see docs/formats/chapters.md, Open values)
- [x] 2 Real-data checklist for Reuben's review of integration (docs/REAL_DATA_CHECKLIST.md)
- [x] 3 Performance and E2E pass over everything merged (outdoor light spell no longer toggles light count at dawn/dusk, note synth capped at 256 notes, e2e covers light spell and book viewer)

Backlog 4 (from Opus real-data review of integration at 7e8a3b6, 2026-10-07):
- [x] 1 Books: the illuminated drop cap (e.g. C11.BOK page 1 "B") overlaps the first text line; indent the first lines beside the initial instead of drawing text under it (books.md image placement)
- [x] 2 `?chapter=N` start position is nondeterministic: chapter 2 landed once in zone 11 at (8, -8) and once in zone 1 at the default spawn. The start-of-chapter teleport races the scene load, and the (8, -8) looks like unscaled tile coordinates. Make the chapter start await the scene and apply the real start position
- [x] 3 Mine zone 10 at the default `?zone=10` spawn renders fully black (no lantern pool, no geometry visible). Spawn inside the tunnels (zone entry point) and make sure the lantern lights the floor even if the party starts outside
- [x] 4 (measured 118 fps in LOCAL_BACKLOG round 8) Chapter 5 (zone 5) runs at 20 fps vs 60 fps elsewhere on the same GPU (74 sprites, 17k tris): profile with F3 and fix the hot spot
- [x] 5 Startup main menu no longer covers `book`, `cutscene`, `chapter`, `zone` debug starts (fixed on main)

Backlog 5 (from Opus, 2026-10-08; start after open PRs and Backlog 4):
- [x] 1 Standalone build without the dev server: on first run ask for the BaK folder with the File System Access API (`showDirectoryPicker`, with drag-and-drop / file-input fallback), cache KRONDOR.RMF/.001, STARTUP.GAM and music in OPFS, loading screen with progress; `npm run build` produces a static site that works from any static host; README section
- [x] 2 Input: gamepad support (move/turn, menus, combat), key rebinding in Options, optional mouse-look in the party view, field-of-view and UI-scale sliders
- [x] 3 Combat and rules audit against BaKGL: hit chance, damage, armour, wounds, spell costs, skill gains; fix discrepancies; table-driven tests (docs/formats/combat-audit.md; fixed wear, melee practice, blessings and enchantment damage, spell affordability; monster resistances and shields left open)
- [x] 4 Chapter 1 critical-path e2e test with synthetic data: start, first dialogue, a town, a shop purchase, a combat, a chest, a zone transition, save and load (tests/chapter1Journey.test.ts)
- [x] 5 Loading and error screens: zone-load progress, friendly errors for missing/wrong game data, WebGPU-not-available message noting the WebGL2 fallback
- [x] 6 Code health: ESLint + Prettier in CI **done by Opus** (`npm run lint`, `npm run format:check`; run `npm run format` before committing). Dead helpers and nine stale probe scripts removed (Opus 2026-10-14; knip finds no other unreferenced code). Music and graphics quality moved out of src/game/main.ts (musicControls.ts, graphicsControls.ts); what remains there is the composition root wiring the install* modules together
- [x] 7 Journal/notes screen: research BaKGL for a bookmark or quest log; otherwise a simple notes screen of key dialogue lines seen (BaKGL not readable from the cloud, so this is the simple notes screen: J, dialogue lines kept via saveExtras)

Backlog 6 (from Opus and the local real-data checks, 2026-10-08; do these before Backlog 5 items 3 and 6; item 1 first, it blocks towns, shops, inns and temples):
- [x] 1 **Town scenes go black**: fixed. PR #78 (slots default to 0 inside a script) was needed but not enough; the real cause was that `composeScene` looked slots up per script while a town scene loads its picture in one script and draws it in the next (G_TOWN.TTM scripts 10 then 13). Slots now carry across scripts (Opus, d1e3f6a); 101 of 117 scenes compose to distinct pictures and LaMut shows its picture in game.
- [x] 2 (verified on real data by Opus: ?chapter=2..9 all start on their recorded positions; chapters 6-9 also needed missing /bak/ files to be 404s, c391c6d. Cause: a start-script teleport into a town has all-zero tile and cell, i.e. (800, 800), and moved the party there; such teleports now keep the party's position) **`?chapter=2` starts at (8, -8) in zone 11, a black void**. Real-data facts (Opus, 2026-10-08): every chapter's start record is valid and on its zone map:
  ch1 zone 1 tile 10,16 cell 18,25 -> (669600, 1064800); ch2 zone 11 tile 11,11 cell 10,10 -> (720800, 720800); ch3 zone 3 tile 23,18 cell 15,32 -> (1496800, 1204000); ch4 zone 12 tile 10,10 cell 35,35 -> (696800, 696800); ch5 zone 5 tile 23,17 cell 20,17 -> (1504800, 1116000); ch6 zone 11 tile 11,11 cell 10,10 -> (720800, 720800); ch7 zone 7 tile 13,15 cell 18,17 -> (861600, 988000); ch8 zone 9 tile 11,13 cell 34,18 -> (759200, 861600); ch9 zone 10 tile 14,13 cell 9,21 -> (911200, 866400).
  Yet the party ends at BaK (800, 800) = 720800 mod 1600: something after the start record (the chapter transition, start-of-chapter script or its teleport) overwrites the position with a cell-local value. The #79 warning never prints on `?chapter=2`: that start goes through the up-front `loadChapterStart` path in main.ts, not the transition where `warnIfOffMap` is called. Find what moves the party to (800, 800), fix it, and test that ch2-9 end on their recorded positions.
- [x] 3 Main menu panel spans the whole window width: make it a compact centred box (done locally with the new title screen)
- [x] 4 (grid slides off cliffs and disables cells that stay on one: src/combat/gridFit.ts; needs a real-data check at the zone 7 spot; hiding world props that overlap the grid is a follow-up, they are baked into merged meshes) Combat in zone 7 (`?zone=7&x=791141&y=988500&h=0`): the "torches" are the scorpions' raised tails with red stingers (art, fine). The real bug: with the party facing north (h=0) the third scorpion stands on the rock face behind the grid, outside it; facing south (`y=992000&h=128`) all three are on the grid. Enemy placement depends on heading and can leave the grid: keep every combatant on a grid cell. Minor: a 3D corpse model lies across a grid cell; hide world props that overlap the grid during combat.
- [ ] 5 The code is now Prettier-formatted (commit 5d6c027, see .git-blame-ignore-revs): merge main into any old branch before continuing it
- [x] 6 (Opus 2026-10-14: trees, props, bodies and sprites in the grid and between it and the camera are hidden during the fight, src/render/hideInstances.ts; merged original models are not) Combat view: world props on or in front of the grid hide the fight. At `?zone=7&x=791141&y=988500&h=0` the grid now slides back off the hill (gridFit + collision outlines, Opus 2026-10-11), which puts a pine between the camera and the grid; the 3D corpse from item 4 still lies across a cell. Hide or fade props inside the grid and between the combat camera and the grid while a fight is on (they are in merged meshes, so this needs per-item visibility or a camera-side fade).

Backlog 7 (from the original manual, Opus 2026-10-15; see docs/GAME_MECHANICS.md "Manual vs the remake" for the status of every rule):
- [x] 1 (Opus 2026-10-16: done except quarrels and inventory-in-combat, see GAME_MECHANICS.md; tests/combat-manual-rules.test.ts) Combat rules the manual describes that we lack: initiative by clicking a foe and enemy ambushes; shoot or cast only at least one step from the nearest enemy; crossbow line of sight, quarrels and wild shots that can hit allies; retreat refused while anyone is down; parry then riposte after Defend; Assess; Rest that heals but raises the risk of being hurt; auto-combat; inventory in combat costs the turn
- [x] 2 (Opus 2026-10-16) Flamecast hits everyone within two steps of the target (we hit adjacent enemies only); Gift of Sung (not on the caster, capped at full Health); Grief only on sentient targets; Stardusk outdoors only; Lightning Staff casts for free; Infinity Pool; Final Rest stops dead Nighthawks rising as Black Slayers
- [x] 3 (Opus 2026-10-16) Travel: Follow Road mode; no camping with enemies nearby; daily rations while walking, and eating at once when rations are given to a starving character; poison worse in combat
- [x] 4 (Opus 2026-10-16) Repairs: Armorcraft restores a share of the lost condition equal to the skill; no repair if repaired recently
- [x] 5 (Opus 2026-10-16) Map: N key for north-up, dark-until-explored dungeon maps, white cities and brown towns with names on hover
- [ ] 6 Smaller rules (done 2026-10-16: Scent of Sarig is the only warning of a trapped chest, leftover loot stays on the bodies as a searchable pile, monster resistances from the original table, enemy morale): Scent of Sarig shows trapped chests; wordlock clue plates need someone who reads Moredhel; dropping items in bags (looted in open fields and near towns); shades from dug-up graves; enhancement hit effects (green flash, red sparks, blue sparkle, white or blue glow); a skill-focus toggle on the character sheet; enemy morale (patrols flee when hurt, a dead leader routs the rest)
