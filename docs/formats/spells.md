# Spells (`SPELLS.DAT`)

Format notes from reading `bak/spells.cpp` in [BaKGL](https://github.com/xavieran/BaKGL) (reference only); our parser is `src/formats/spells.ts`, rules in `src/game/spells.ts`. Little-endian. Nothing here is verified against the real file yet.

## Layout

1. `u16` spell count (BaKGL treats 45 spells, `0x2d`, as the learnable range).
2. Per spell, 11 `u16` (22 bytes): name offset, `minCost`, `maxCost`, combat flag (BaKGL: "martial", 1 = combat spell), `targeting`, `color` (0xffff none), `animation` (0xffff none), `objectRequired` (item index, 0xffff none), `calc`, `damage` (i16), `duration` (i16).
3. One `u16` gap, then NUL-terminated names; each name offset is relative to the position right after the gap.

`targeting` (BaKGL comments): 0 enemies in line of sight, 1 enemies ignoring it, 2 and 3 allies, 4 enemies, 5 and 6 empty cells. `calc`: 0 non-cost-related, 1 fixed, 2 cost x damage, 3 cost x duration, 4 and 5 special.

## Characters and items

* A character's known spells are a 48-bit field (already parsed in the save, `Character.spells`). A character is a magic-user when the `casting` skill maximum is non-zero.
* A **scroll** (item type `0x0d`) stores its spell number in the item's condition/quantity field; using it teaches the spell to a magic-user and uses the scroll up. Reading one already known fails and keeps it. Scroll prices are the trailing table of OBJINFO (see items.md).
* A **book** (`0x11`) raises the skill named by the lowest bit of `effectMask` by `effect` on the first reading; later readings gain `alternativeEffect` when a 0-99 roll exceeds `potionPowerOrBookChance`. Each reading uses one charge (the quantity field).
* Timed "static" spells (BaKGL): 0 Dragon's Breath, 2 Candle Glow and 26 Stardusk are lights; 34, 35 and 8 are other timed spells. A cast lasts one hour of game time per point of power. The save keeps these in a `u16` bitmask of active spells.
* Casting spends points: BaKGL checks total Health against the minimum cost.

## Our stand-ins (**unverified**)

BaKGL does not implement combat spell effects, and SPELLDOC text is not needed to cast. What a spell does is derived from the table (`spellKind`):

* `damage`: combat spell, `damage > 0`, targeting 0, 1 or 4. Amount is `damage` (or `power x damage` for calc 2 and 3). Ignores armour.
* `heal`: `damage != 0`, targeting 2 or 3. Restores `|damage|` (scaled the same way) Health to an ally, capped at maximum Health.
* `light`: spells 0, 2 and 26, cast outside combat.
* everything else is listed as unsupported and not offered.

The cost (power) comes off Stamina then Health, never below 1 Health; the caster picks a power between `minCost` and `maxCost` (the world cast menu offers low, middle and high; combat uses as much as affordable). Combat casting needs a target within 8 cells; casters earn 2 `casting` experience per cast. Enemies cast too (see below). Books already read are remembered per session only.

## Controls

World: **V** casts (healing and light). Combat: **C** cycles through the caster's spells, then click the target. Inventory: use (U / Enter) on a scroll or book.

## Enemy casting (**unverified**)

BaKGL has no monster spellcasting and the save parser reads no monster spell lists, so this is our own stand-in. Enemy fighters get spells from their save `casting` skill (`monsterSpells`, src/combat/roster.ts): below 30 they cast nothing; from 30 they know every damage or healing spell that needs no carried item and whose minimum cost is at most a third of the skill, and always at least the cheapest damage spell.

On its turn (`castTurn` in src/combat/ai.ts, after the badly-hurt defend check and before shooting or melee) a caster:

1. heals the most hurt living ally within 8 cells who is at half Health or less, if it knows a healing spell;
2. otherwise casts its strongest damage spell at the weakest foe within 8 cells.

Enemies pay only from Stamina (`castSpell`'s `maxSpend`), never Health, and only when Stamina covers the spell's minimum cost; a drained caster falls back to melee, shooting or moving. Spell damage ignores armour, as for the party; casts show in the combat log like the party's.
