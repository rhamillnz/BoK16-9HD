# Containers, locks and riddle chests

Notes on chests, bags, gravestones and the locks on them. Derived from reading `bak/container.cpp`, `bak/fixedObject.cpp`, `bak/lock.cpp`, `bak/save/containers.cpp`, `gui/lock/*` and `gui/guiManager.cpp` in [BaKGL](https://github.com/xavieran/BaKGL) to understand the layouts; our implementation is written independently (`src/formats/containers.ts`, `src/game/locks.ts`, `src/game/wordLock.ts`, `src/game/containers.ts`). Nothing here has been checked against the real files yet, so treat it as "per BaKGL". Items marked **unknown** are kept raw.

## One record layout, three headers

World chests, shops and enemy loot all use the same record: a 12-byte location header, a 4-byte common header, the inventory, then optional sections.

World header (12 bytes): `zone u8`, `chapterRange u8` (high nibble first chapter, low nibble last, inclusive), `model u8`, `unknown u8`, `x u32`, `y u32` (BaK units, absolute).
Shop header: 4 unknown bytes, `gds u32`, `hotspot u32` (1 = 'A').
Combat header: 4 unknown bytes, `combatant u32`, `combat u32`.

Common header (4 bytes): `locationType u8` (**unknown**; 7 for combat), `items u8`, `capacity u8`, `flags u8`.

Inventory: `items` records of 4 bytes (`itemIndex`, `conditionOrQuantity`, `status`, `modifiers`, as in a character inventory), then `capacity - items` empty 4-byte slots.

Optional sections follow in this order, each present when its flag bit is set:

| Bit | Section | Bytes |
|---|---|---|
| 0x01 lock | `flag u8`, `rating u8`, `fairyChestIndex u8`, `trapDamage u8` | 4 |
| 0x20 door | `doorIndex u16` | 2 |
| 0x02 dialogue | `contextVar u8`, `dialogOrder u8`, `key u32` | 6 |
| 0x04 shop | shop statistics (parsed by the shop code) | 16 |
| 0x08 encounter | `requireEventFlag u16`, `setEventFlag u16`, `gds u8`, `hotspot u8` (1 = 'A'), `hasCell u8`, `cellX u8`, `cellY u8` | 9 |
| 0x10 time | last-visited time `u32` | 4 |

## Where containers live

- **`OBJFIXED.DAT`**: two skipped bytes, then for each zone in order a `u16` count and that many world records. The pristine placement, used when a save has no block for the zone.
- **A save image** (`STARTUP.GAM`, `*.GAM`): 13 blocks of world records at fixed offsets, one per zone number 0..12 (offset, count: `0x3ab4f` 15, `0x3b621` 36, `0x3be55` 25, `0x3c55f` 54, `0x3d0b4` 65, `0x3dc07` 63, `0x3e708` 131, `0x3f8b2` 115, `0x40c97` 67, `0x416b7` 110, `0x42868` 25, `0x43012` 30, `0x4378f` 60). This is the live state; the game reads it first. Shops (98 records at `0x443c9`, shop header) and combat loot (1734 at `0x46053`, combat header) follow the same record layout.

A container is present in a chapter when the chapter lies in its range. Its encounter section can hide it until `requireEventFlag` is set and sets `setEventFlag` once it has been opened. Records with a door section are locked doors, not containers; records with a shop section are shops or inns. The container screen ignores both.

## Locks

`rating` is the lock difficulty. `fairyChestIndex != 0` makes the chest a word lock (below). `flag` 1 or 4 means the chest is trapped; other flag values are **unknown** and treated as plain locks.

- Classification by rating: below `0x33` easy, below `0x51` medium, below `0x65` hard, otherwise unpickable (the lock picture in the original).
- Some exact ratings belong to a key. Keys are items `60 + n` for `n` in 1..11 and key `n` opens the lock whose rating is entry `n` of `0x00, 0x32, 0x5a, 0x65, 0x66, 0x67, 0x68, 0x46, 0x3c, 0x50, 0x69, 0x6a`. Ratings `0x65..0x6a` (101 to 106) can only be opened with their key. A rating of 0 means no lock.
- The lockpick is item `0x50` ('P'). Keys and the lockpick live on the party key ring.
- A character can pick a lock when its rating is at most 100 and their Lockpick skill is greater than the rating. The best Lockpick among the active party is used.
- A failed pick snaps the lockpick with chance `(rating - skill) * 2 / 3` percent, and teaches the character something with a 40 percent chance (skill improvement itself is backlog item 8).
- A wrong ordinary key (own rating 100 or less) snaps with chance `((100 - keyRating) - skill / 3) * 2 / 3` percent. Special keys never snap.
- What the character tells about a lock by looking: easy for them, too complicated, needs a special key (101..106), or broken beyond repair (above 106). The original also remembers per lock index whether the party has seen that lock opened by its key (event flags); not implemented.

## Word-lock riddle chests

`fairyChestIndex` selects a riddle text: dialogue key `0x19f0a0 + index`. The text has three parts separated by the two-character string `\n#`: the answer, a block of option rows (one per line), and a hint. Every option row has the answer's length (at most 15). The screen shows one tumbler per letter; tumbler `i` cycles through letter `i` of every option row, starting with the first row. The chest opens when the letters spell the answer. Giving up leaves it shut. The puzzle music is song 3 (`songs.ts`), not wired yet.

Whether the dialogue text still carries style bytes (such as `0xf7`) in front of the parts is **unknown**: the loader strips control and high bytes before parsing, and a riddle that does not parse opens the chest with a console warning rather than locking the player out.

## Traps (approximation)

`trapDamage` is the damage dealt to each party member (Stamina first, then Health) when the trap goes off. `TRAPS.DAT` describes a small puzzle (u16 element count, then 15 slots of `u16 element, u8 x, u8 y`; elements: red and green crystal, diamonds, blasters, characters, exit) which BaKGL parses but does not play, and we do not either. Instead, a trapped chest offers: try to disarm (succeeds with chance equal to the best Lockpick skill, between 5 and 95 percent), open anyway, or leave. A failed disarm or opening anyway springs the trap, once; afterwards the chest opens normally.

## In the game

E opens the container nearest the party within 1200 units (a bit under one map cell). The container screen lists the container (left) and the selected character's inventory (right): click a container slot to take it, a character slot to put it in, T takes everything that fits, Q/E or the tabs change character, Escape closes. Money items go to the purse and keys to the key ring. Equipped items must be unequipped first. Opening sets the container's event flag and closing plays its dialogue (when it has one). Container contents and lock/trap state are saved with the game (`extras.containers`).

## Not done

- Tomb digging (needs a shovel; per BaKGL dialogue keys `0x42..0x44`), bodies, bags that vanish when emptied, the hotspot a container can lead to, and door locks.
- Skill improvement from picking locks (backlog item 8) and the per-lock "seen" flags.
- The `TRAPS.DAT` puzzle.
- Chests of chapters other than the one the save starts in come from `OBJFIXED.DAT` only when the save has no block for the zone.
