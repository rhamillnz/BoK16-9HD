# Combat

Notes on how combat works, for `src/combat/grid.ts` and `src/combat/turns.ts`. Derived from reading BaKGL (`game/combat/*`, `bak/combat/*`, `bak/coordinates.cpp`, `bak/constants.hpp`) to understand the rules; our code is written independently. Nothing here has been checked against the real game yet. Where BaKGL leaves something as a TODO or guess, it is marked **unverified**.

## Grid

- A combat happens on a **8 columns x 13 rows** grid (`gCombatGridCols`, `gCombatGridRows`). Underground combats use **7** rows (`gCombatGridRowsUnderground`), though BaKGL's manager always allocates 13.
- Cell size is **300 world units** (a world cell is 1600, so about 5.3 grid cells per world cell).
- Cell `(x, y)`: x grows east, y grows north, relative to the party facing north.
- **World placement**: cell (0, 0)'s corner sits at `(-1200, +3200)` from the party position when it faces north; combatants stand at cell centres (add 150 to each axis). The offset and the cell offsets are rotated by the party heading **snapped to a quarter turn** (heading is 8-bit, 256 per turn, snap size 64). `gridCellToWorld` implements this.
- **Start positions**: enemies come from per-combatant records in the save (`CombatantGridLocation`, grid x/y plus monster index, state, retreat factor). Party members have a fixed starting grid position per character. Neither is decoded by our save parser yet.

### Directions

Eight directions in sprite order: South 0, SouthEast 1, East 2, NorthEast 3, North 4, NorthWest 5, West 6, SouthWest 7. Deltas: North `(0,+1)`, East `(+1,0)`, etc. An 8-bit heading maps to a direction with `((heading + 144) % 256) / 32`, so heading 0 is North and 128 is South. The direction between two cells is the heading of the straight line between them (`atan2`), then the same mapping.

Combat sprites only exist for South, SouthEast, East, NorthEast, North; the west-facing directions mirror the east ones.

### Cell state

Per turn the manager computes bit flags for each cell from the point of view of the combatant about to act:

| Flag | Meaning |
|---|---|
| Reachable | Free and within movement range |
| Attackable | Holds a living opponent |
| IsAlly | Holds a living friend |
| Disabled | Blocked terrain (set by the encounter) |

Other flags exist (line-of-sight attackable, zap, mine, crystal) for spells and traps and are not modelled.

A living occupant makes its cell unreachable; a corpse does not. Disabled cells are unreachable and cannot be walked through.

### Movement

- Moves are **8-directional**; a diagonal step costs the same as an orthogonal one. BaKGL does not stop diagonal steps cutting corners between two blocked cells.
- A cell is reachable when its shortest path from the mover has **at most `Speed` steps** (the current Speed skill, not the maximum).
- Path search is breadth-first with neighbour order starting from the direction toward the destination, then alternating either side (`straight, +1, -1, +2, -2, +3, -3, +4`), so paths run straight where possible. The destination may be blocked (an enemy's cell).

### Attacking

- **Melee range is orthogonal adjacency**; diagonal neighbours are not adjacent (`IsAdjacent`).
- Any living enemy cell is attackable, however far. Clicking one moves the attacker to the best neighbour first. BaKGL applies **no speed limit to that approach** (the path is queued whole); whether the original does is **unverified**, so `planAttack` takes an optional `maxSteps`.
- Best attack cell: the current cell if already orthogonally adjacent; otherwise the free orthogonal neighbour of the target with the shortest path (ties: north, south, east, west).
- **Slash** (right click) is only allowed if no move is needed, and costs 1 stamina, so it needs more than 1 left. **Thrust** (left click) can follow a move. Ranged attacks, crossbows and spells are not part of the grid code in BaKGL; **unverified**.
- To-hit (`CalculateMeleeResult`): roll 0-99 (+20 if the defender is defending); score = attacker Melee + weapon accuracy adjusted by race (`0` or `-1`/`-2` between race pairs), weapon condition and blessing, minus defender parry (Defense / 4, +blessing from armour, 0 if the defender cannot act), clamped to 2-98. Hit when roll < score. Not implemented here.

## Turns

- A combat is a series of **rounds**. In a round every living combatant acts once.
- **Order**: the combatant with the highest current Speed among those still pending acts next; ties go to the one **later** in the combatant list; Speed 0 counts as 1. The order is recomputed before each turn, so a speed change mid-round matters. The party member to start the combat is the fastest *party* member.
- When nobody is pending a new round starts: all combatants that are not dead or exorcised become pending again, Speed is restored to its maximum (and bumped from 0 to 1), and end-of-round spell effects tick.
- A combatant under Dannon's Delusions, Despair Thy Eyes or Grief of 1000 Nights is **not active**: it gets no turns but is still counted as alive.
- End of turn: mark done; if poisoned, take 1-2 damage (it can die); check whether combat is over; pick the next combatant.
- **Defend** and **Rest** both just end the turn; defend flags the combatant so attackers' hit rolls get +20. BaKGL never clears that flag (**unverified**); our `startNextRound` clears it.
- **Combat ends** when one side has no living members: no enemies left is a win, no party left is a defeat. Flee succeeds unless more than one party member is dead, ending as a retreat (BaKGL always succeeds otherwise; the 50% roll is commented out). Exorcised combatants (ghosts) are removed from play without being counted as dead.
- Resurrection of Nighthawks while a Blackslayer lives, Wrath of Killian and illusions leaving the fight are stubs in BaKGL and not modelled.

## COMBAT.TBL

`COMBAT.TBL` uses the same container as the zone tables (`MAP:`, `APP:`, `GID:`, `DAT:`, see `zones-and-models.md` §1) but holds one model per monster appearance, loaded through `parseTBL`.

- Each model has exactly **one component** whose meshes are **animations**, in this order: Idle 0, Dead 1, Slash 2, Thrust 3, ParryLow 4, ParryHigh 5, Ranged 6, RangedCast 7, StaticCast 8. A model may have fewer meshes.
- Each mesh's face options are billboard sprite frames (face type 2): the sprite file index, X/Y offsets, base vertex and scale (our `Model.sprite` only keeps the first).
- Face options are grouped by facing: **5 directions** (S, SE, E, NE, N) when the count is a multiple of 5, **3 directions** (S, E, N) when it is a multiple of 3. Frames per direction = face options / directions, in direction-major order.
- Counts that are not a multiple of 3 or 5 are special-cased by BaKGL: 7 for `dread` is treated as 6, and the dog and wyvern models gain one.
- The sprite sheet used by a mesh is not stored; BaKGL guesses it, bumping to the next of up to three `*.BMX` files when the sprite index drops.

### The `dots` model

Real-data testing showed model 38 `dots` fails with a read-past-end error in `parseModel`. BaKGL has **no special case** for it (only `boom` is special-cased) and its model reader is byte-for-byte the same layout as ours. The difference is that BaKGL's `FileBuffer` reads through a raw pointer with no bounds check, so a record that runs off the end of the `DAT:` chunk silently reads whatever follows in memory. The likeliest explanation is therefore that `dots` has a truncated or oddly laid out record that the original engine and BaKGL never fully consume (it is a particle effect, not a monster). We could not confirm this without the data; it needs a hex dump of that record.

Consequently `parseTBL` now **tolerates** a model (or clip) that fails to parse: its slot is `undefined` and a message is added to `ModelTable.warnings`. Callers that need monsters should check the slot, not assume every name has a model.

## Playable combat (first pass)

How `src/game/combatEncounter.ts` turns a combat encounter into a fight. Everything here is read from BaKGL (`bak/encounter/combat.ipp`, `bak/save/combat.cpp`, `bak/save/character.cpp`, `bak/combat/calculations.cpp`, `game/combat/combatManager.cpp`, `game/gameRunner.cpp`) and has **not** been checked against the real game data yet.

### From encounter to fighters

1. A combat encounter (type 1) has `tableIndex` into **`DEF_COMB.DAT`**. `parseCombatTable` (`src/combat/combatData.ts`) reads it: `u32 count`, then **400-byte records**: 3 skipped bytes, `u32` combat index, `u32` entry dialogue, `u32` scout dialogue, `u32` zero, four retreat points (north, west, south, east; each `u32 x, u32 y, u16 heading<<8`, tile-relative), `u8` enemy count, **7 combatant slots of 48 bytes** (`u16 monster, u16 movement type, position, min/max x and y ranges, padding`), `u16` zero, `u16` ambush flag. Unused slots are padding.
2. The record's **combat index** (not the table index) addresses the save image. `readCombatEnemies` reads, for combat `n`: the entity list at `0x1383 + n*14` (seven `u16` combatant ids, `0xffff` = empty); for each combatant `c` its grid location at `0x31349 + c*22` (`u16 currentTarget, u16 monster, u8 gridX, u8 gridY, u8 targetX, u8 targetY, u8 state, ... u8 retreatFactor at +14, ...`; state bit `0x02` = dead) and its skills at `0x914b + c*95` (same layout as a party skills block). The enemy start cells therefore come from the save, not from DEF_COMB. When the save has no combatants for the combat, `buildFighters` makes generic stand-ins from the table's monsters.
3. **Party start cells and sprites** come from **`P1.DAT`**: six 22-byte grid-location records (same layout as above), one per character slot; the monster field is the character's combat sprite. BaKGL parses these in `LoadCharacters`.
4. Names: `MNAMES.DAT` (`u32 count`, `u16 offsets`, NUL-terminated strings; monster *n* is record *n-1*, index 0 is invalid). Sprite sheets: `BNAMES.DAT` (same framing; each record is a NUL-terminated prefix plus four bytes: three sheet suffixes and a colour-swap number). The sheet used for the idle frame is `<prefix><suffix0>.BMX` and the sprite is the first face option of `COMBAT.TBL`'s model for that monster (mesh 0 = Idle, direction South, frame 0). Colour swaps (`CSn.DAT`) and the other directions and animations are **not applied yet**; fighters whose sprite cannot be found are drawn as coloured tokens.
5. Fighters take their stats from the skills (Health and Stamina are the current `trueSkill` values; the rest are `trueSkill + modifier`, party members through `effectiveSkill`). Party members fight with their equipped sword or staff and armour. Enemy weapons and armour are in the save's combat inventories (`0x46053`, 1734 containers), which are **not parsed**, so monsters fight unarmed: damage is their Strength alone.

### Formulas (`src/combat/rules.ts`)

- **Hit**: roll 0-99, plus 20 if the defender is defending; score = Melee + weapon accuracy (thrust or swing) adjusted by race `(base * (raceEffect + 100) / 100)` then by condition `/ 100`, minus the defender's parry (`Defense / 4`, 0 when it cannot act, capped at 98), clamped to 2..98. Hit when roll < score. Blessings are not modelled.
- **Damage**: Strength + `weaponStrength * condition / 100` (thrust or swing), at least 1. Sword modifiers (bonus damage vs monsters, Guarda Revanche's double damage vs moredhel) are not modelled.
- **Armour**: reduction % = `Defense / 4 + condition * armourRating / 100`, scaled by the race effect, capped at 98; damage = `damage * (100 - reduction) / 100`, and when that is 0 or less a roll of 1-2 is dealt instead. The armour rating is the item's accuracy-swing field.
- **Applying damage**: Stamina is drained first, the excess comes off Health; at 0 Health the combatant is dead. A slash (swing) costs the attacker 1 damage (BaKGL deals it with no armour reduction) and needs more than 1 Stamina; a thrust is free.
- Weapon dulling, skill improvement from fighting, poison, spells, shields and crossbows are not modelled.

### What the first pass does differently

- **Movement and attacks are limited to Speed steps** per turn, including the approach to an attacker's target (BaKGL does not limit the approach; **unverified** for the original). Moving without attacking uses the turn.
- **Enemy AI** is a stand-in: strike the nearest party member that can be reached this turn, otherwise step to the reachable cell closest to the nearest one, otherwise wait. BaKGL's AI and `retreatFactor` use were not read.
- **Retreat point**: the side is picked from the party's offset from the encounter's centre (`retreatSide`); BaKGL's `CalculateRetreatDirection` was not read (**unverified**). A retreat does not mark the encounter done, so it fires again when re-entered.
- **Win**: the encounter's completion flag and "seen" state are set, as for dialogue encounters. The post-fight dialogue (including the "someone died" and Makala dialogues), entry and scout dialogues, loot and experience are not run.
- **Defeat**: no game-over flow yet; the fallen get 1 Health back and the party retreats as if it had fled.
- **Wounds** are written back to Health and Stamina; anyone who fell gets Near Death 100.

### Camera and grid

The grid is placed with `gridCellToWorld` (see Grid above). `src/combat/layout.ts` adds the inverse (`worldToGridCell`, used to pick the cell under the mouse) and a camera plan: above and behind the near edge, looking at the grid's middle. These camera numbers are our own; the original's live in a file we have not read.

Controls: click a blue cell to walk there, a red cell to attack (shift-click or the Slash toggle for a slash); D defend, W wait, Q retreat, S toggle slash, Enter to leave the result screen.
