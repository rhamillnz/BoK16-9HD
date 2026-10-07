# Real-data checklist for `integration`

Everything on `integration` was built and tested in the cloud against small synthetic fixtures; no original game file was ever available. This is the ordered list to run against a real Betrayal at Krondor install and real WebGPU before fast-forwarding `main`.

Each step says what to open or press, what correct looks like, and the **most likely wrong assumption** (where to look first if it fails). Detail for each format is in `docs/formats/`. Anything found wrong goes back as a backlog item: the fix is nearly always one constant or one offset.

Items marked **(pending)** are open PRs against `integration` when this file was written (#59 overhead mine maps, #60 enemy spells). Skip them until they have merged.

## 0. Setup

1. `BAK_DIR="<your install>" npm run dev`, open <http://localhost:5173/game.html> in current Chrome or Edge.
2. Open the browser console. **Correct:** no red errors, "Game data not found" absent. A yellow warning about a model failing to parse is expected for COMBAT.TBL (see combat.md).
3. Press **F3**. **Correct:** fps, frame time, draw calls, triangles update. Note the numbers; step 14 compares against them.
4. Confirm the renderer is WebGPU, not the WebGL2 fallback (F3 overlay or the console).
- Most likely wrong: `BAK_DIR` path, or a file-name case mismatch on Linux (`KRONDOR.RMF`, `STARTUP.GAM`, `FRP.SX`, `BOOK.SCX`).

## 1. Boot, walking, terrain (zone 1)

Open `game.html?zone=1`. Walk with WASD, run with Shift.
- **Correct:** terrain, tile models, trees and grass look right and nothing floats or clips badly; sky and clock work (`[` and `]` move the clock 30 minutes).
- Most likely wrong: model `scale` byte (exposed but not applied, zones-and-models.md), sprite sheet guessing for monsters, tile heights.

## 2. Menu, HUD screens, save/load

Esc opens the main menu. Press I, C, Tab, F6.
- **Correct:** menu entries work; inventory shows real item names and icons; character sheet shows real stats and skills; map shows tiles and a compass.
- Quick save with **F5**, walk away, **F9**. **Correct:** you return to the saved spot with the same heading. Then F6, save to a slot, reload the page, load it from the slot screen.
- Most likely wrong: saved heading scale (`0x86`, savegame.md says unverified), the save-image offsets for money, time and inventories, and the JSON `extras` sections (`containers`, shop stock). Also load `STARTUP.GAM` via New Game: the starting party names, health and inventories must match the real game.

## 3. Books and cutscenes

Open `game.html?book=C11.BOK`, then `C12.BOK`, `C21.BOK` and so on.
- **Correct:** the BOOK.SCX background in BOOK.PAL colours, the page pictures at the right place and size, text in the book font that wraps inside the text box; a click turns the page; the last click (or Esc) closes it.
- Most likely wrong: image position and size (we use half the book values), line spacing (font height + 1 is a guess), the italic mark `0xf3` and paragraph end `0xf8` handling, text overflow from page 0 into page 1's box. See books.md.
- Then `game.html?cutscene=CHAPTER1.ADS,CHAPTER1.TTM`. **Correct:** animation plays at a sensible speed with the right sprites, palette and layering, and its sound and music cues fire.
- Most likely wrong: rotation angle units in opcode `0xa5a0`, frame delay units, slot handling, music-change timing (cutscenes.md).

## 4. Chapter transitions and hand-over

Open `game.html?chapter=2`, then 3 to 9 in turn (or end a chapter in play).
- **Correct:** each chapter starts at the right place and time, with its map caption (dialogue key `0x126 + n - 1`), all characters at full health with no conditions, encounters firing again. Finishing a chapter plays the old chapter's book and animation, then the new intro (`CHAPTERn`, `Cn1.BOK`, `Cn1`).
- Hand-over: **chapter 2 on** the purse should carry per chapter; **chapter 4** Owyn's and Gorath's inventories move into zone 12 chests, each given six torches; **chapter 5** Locklear gets the reference container contents with a sword, armour and crossbow equipped.
- Most likely wrong: the money slot `0x12f7 + ((chapter - 1) << 2) + 0x64`, the chest positions in chapter 4, which characters the chapter 5 swap applies to.
- **Known gaps, expect these to look wrong:** town stashes (Locklear's room in chapter 2, the Lurough inns in chapter 6), the chapter 7 flag `0x1ab1`, and the 80 half-hour expiry steps are not implemented because the rule tables in `src/game/chapterRules.ts` are empty (chapters.md, Open values). They need BaKGL values.

## 5. Towns, dialogue, temples

Walk into a town; click hotspots (inn, shop, temple, houses, people).
- **Correct:** the scene still picture and hotspots line up; hotspot availability follows the chapter; dialogue boxes show real text with names and numbers filled in; choices work; keywords/topics behave.
- Temples: heal and cure for a donation, bless, and the teleport screen. **Correct:** it lists only temples you have visited (flag `0x1950 + temple`) and needs two.
- Most likely wrong: which dialogue values count as flag pointers (towns.md, "Availability"), the game-state flag names, the units of ElapseTime and the skill-check rule (compare vs roll, dialogue.md), the temple "seen" rule (the original may list every temple).

## 6. Shops and haggling

Open a shop hotspot (mouse). Buy, sell, haggle, try to buy with too little money, sell a lone weapon, haggle on a scroll.
- **Correct:** real prices from OBJINFO; the buy and sell offer dialogues (keys `0x1b7757`, `0x1b7756`...) show the price; haggling success moves the price; the shop remembers what you sold after save and load.
- Most likely wrong: price formula and haggling skill maths, item sell values (shops.md), shop stock record layout in STARTUP.GAM, sell-back rules for categories a shop will not buy.

## 7. Inns and camping

- Inn: click an inn hotspot, pay, sleep. **Correct:** price in royals, the party heals, time passes, rations are eaten, hunger and conditions update (inns.md).
- Camp: in the wild press **R**, pick a plan (rest or sleep, hours). **Correct:** time advances, healing matches what an inn would give for the same hours, rations come from the shared party pool. Resting more than 13 hours cures Sick.
- Most likely wrong: the 30 day maximum health bump (raises the maximum too, unverified), hourly damage after 18 hours awake, the 80 percent camp heal limit, the **4 percent per hour ambush chance, which is our estimate**. Note main.ts does not start fights from ambushes yet.

## 8. Items

In the inventory: use food, a potion, a scroll, a book, a repair kit; equip and unequip; give an item with T; try overweight or full packs.
- **Correct:** effects, sound (the item's `useSound` repeats `soundPlayTimes + 1` times), item names and condition bars match the real game.
- Most likely wrong: weight and slot limits, scroll spell numbers (stored in the condition/quantity field), book skill gain rolls.

## 9. Spells (player)

Press **V** in the world; cast a healing or light spell. Inventory: read a scroll.
- **Correct:** only spells your character knows are offered, cost comes off Stamina then Health, a heal restores the shown amount, light spells (0 Dragon's Breath, 2 Candle Glow, 26 Stardusk) brighten the scene and fade, outdoors at night as well as in mines. Casters gain 2 casting experience per cast.
- Most likely wrong: the **spell kind inference** (`spellKind` in src/game/spells.ts; the damage/heal split from targeting and the damage sign is our stand-in), the cost formula per `calc`, light duration of one hour per power, and which spells should appear at all (some are filtered as unsupported).

## 10. Combat (including enemy spells)

Trigger an encounter. Try D, W, S, F (shoot), C (cast, then click a target), Q (retreat); finish and press Enter.
- **Correct:** grid, turn order by speed, movement limited to Speed steps, hit and damage rolls feel sane, crossbows work, loot and experience come after, wounds appear.
- Most likely wrong: **all the second pass numbers** (combat.md, "Second pass": loot, XP, wounds, AI are our own), the monster sprite sheet guess, retreat direction, defend +20 hit bonus, whether the approach to an attacked target should be speed limited.
- **(pending #60)** Enemy spells: enemies with Casting 30 or more cast damage spells and heal allies at half health or less. Most likely wrong: this is invented. The real game's monster spell lists were never parsed, so check which monsters should cast at all.

## 11. Chests, locks, riddles

Press **E** beside a chest or container; try locked ones, word-lock riddle chests, traps; save and reload.
- **Correct:** contents come from OBJFIXED.DAT and tile objects, take and put work, locks use the picked/open/broke sounds, riddles accept the right word, and opened state survives a save (`containers` extra).
- Most likely wrong: lock rating and pick maths, trap damage, riddle word source, container record offsets. Town containers are the same open item as step 4.

## 12. Sound effects and music

Listen while walking, fighting, buying, opening doors and chests, using items, healing at a temple; press **M** to mute.
- **Correct:** effects play and use the right sound numbers (sword hit 65, miss 19, door 38/39, buy/sell 60, teleport chime 0x0c ...); music follows the zone, `?song=N` overrides it, cutscenes switch tracks.
- **Note-based effects** (entries in FRP.SX with MIDI-style voices instead of wave data): played by a small WebAudio synth at 120 BPM with patch families mapped to waveforms. **Correct:** recognisable and not too loud, no stuck notes, capped at 12 seconds, at most 8 voices. Most likely wrong: tempo (the file has no tempo event, so 120 BPM is a guess), 32 ticks per quarter note, pitch wheel range of two semitones, which sounds should be note-based at all.
- Wave effects most likely wrong: unsigned 8-bit PCM sample rate.

## 13. Mines and overhead maps

Open `game.html?zone=10`, then 11 and 12; press **Tab**.
- **Correct (3D):** black sky, short dark fog, a flickering lantern around the party, half walking speed, ceilings and rooms present, a light spell widens the light.
- **(pending #59) Correct (Tab map):** a tunnel plan drawn from the flattened `_ug` models in `Z10M`, `Z11M`, `Z12M`, in palette colours, matching the 3D layout and the party arrow, with open doors using `m_doorgi_ug`. Compare against the original game's overhead map.
- Most likely wrong: the overhead models' coordinates and scale relative to the 3D ones, colour mapping, draw order (higher items drawn last), door state selection.

## 14. Performance and graphics quality

Press **P** to cycle quality (low, medium, high); `?grass=high&post=high`. Look at F3 in zone 1, in a town and in a mine.
- **Correct:** a stable frame rate at 2560x1440 on your GPU; no hitches when crossing tiles; draw calls drop when you turn away from forests (billboard chunk culling by frustum and fog distance).
- Most likely wrong: real tile counts are much larger than the synthetic data, so culling radius and fog distance may need tuning. This feeds backlog item 3 (performance and E2E pass).

## 15. README options and keys

Run every option in the README table once: `post`, `grass`, `zone`, `x`/`y`/`h`, `song`, `book`, `cutscene`, `chapter`. Check every key in the controls table, and F6 slots, F3, `[`, `]`, F fly camera.
- **Correct:** each does what the README says. If any behaviour differs from the README, fix the README as well as the code.
- Most likely wrong: `h` heading scale (8-bit here, saves may use another scale, see step 2), and keys clashing with browser shortcuts.

## Reporting back

For each failed step, note the step number, what you saw, and what the original does. One line is enough; the fix is usually a constant or offset in the module named above.
