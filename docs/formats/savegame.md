# Betrayal at Krondor: Save Games (`STARTUP.GAM`, `*.GAM`)

Notes on the save-game image, derived from reading the [BaKGL](https://github.com/xavieran/BaKGL) loaders (`bak/save/saveOffsets.hpp`, `bak/save/party.cpp`, `character.cpp`, `world.cpp`, `bak/state/event.cpp`, `bak/state/offsets.hpp`, `bak/save/containers.cpp`). Implemented in `src/formats/gam.ts`; tests in `tests/gam.test.ts` use a synthetic image only.

All values are little-endian. BaKGL reads the file as a flat, uncompressed buffer and addresses everything by absolute offset. Whether the on-disk file is wrapped in any compression is not established here. Offsets are not verified against a real save in this document, except where the BaKGL source states them.

**Status legend:** *decoded* = parsed by `gam.ts`; *raw* = parsed but meaning unknown; *not parsed* = location known, not read.

## 1. Header and world state

| Offset | Size | Field | Status |
|---|---|---|---|
| `0x5a` | u16 | chapter | decoded |
| `0x5c` | u16 x3 | map position x, y, heading | decoded (units/scale not verified) |
| `0x64` | u16 | second copy of chapter (BaKGL asserts equal) | decoded |
| `0x66` | u32 | gold (royals) | decoded |
| `0x6a` | u32 x2 | world time, time last slept | decoded |
| `0x76` | see §2 | location | decoded |
| `0x96` | u8 | follow-road flag | decoded |
| `0x616` | u16 + n*8 | time-expiring events (§5) | decoded |
| `0x6b8` | u16 | active-spells bitmask | raw |
| `0x6e2` | bit field | game event flags (§6) | decoded on demand |
| `0xb09` | bit field | "complex" event flags (§6) | decoded on demand |
| `0xb3b` | ? | tile visibility records | not parsed |
| `0x1ed4` | ? | Pantathians event flag | not parsed |

**Time.** One tick is 2 game seconds. `seconds = ticks*2`, hour = `(seconds/3600) % 24`, day = `seconds/86400`.

## 2. Location block (`0x76`)

| Offset | Size | Field |
|---|---|---|
| `0x76` | u8 | zone (BaKGL asserts <= 12) |
| `0x77` | u8 | tile x |
| `0x78` | u8 | tile y |
| `0x79` | u32 | position x (BaK units) |
| `0x7d` | u32 | position y (BaK units) |
| `0x81` | 5 bytes | **UNKNOWN** |
| `0x86` | u16 | heading (scale **unverified**; the game's walk heading is 8-bit, so a conversion is probably needed) |

BaKGL's own comments label the position reads `0x7a`/`0x7f`, which disagrees with sequential reading from `0x79`. We follow the sequential read as BaKGL's code does.

## 3. Characters

Six character slots; names are read from the file, not assumed. Each slot has data in several separate tables, indexed by character `c`:

| Table | Address | Stride |
|---|---|---|
| name | `0x9f + c*10` | 10-byte NUL-padded ASCII |
| skills block | `0xdb + c*95` | 95 |
| conditions | `0x330 + c*7` | 7 |
| skill affectors | `0x35a + c*112` | 8 slots x 14 |
| inventory | `0x3a804 + c*0x70` | 0x70 |

### 3.1 Skills block (95 bytes)

| Offset | Size | Field |
|---|---|---|
| +0 | 2 | **UNKNOWN** (BaKGL: "character name offset") |
| +2 | 6 | spell bitfield (48 bits; bit n = spell index n) |
| +8 | 16 x 5 | skills, see below |
| +88 | u8 | **UNKNOWN** (BaKGL: combat character index) |
| +89 | 6 | **UNKNOWN** |

Each skill is 5 bytes: `max`, `trueSkill`, `current`, `experience`, `modifier` (signed). Order of the 16 skills: Health, Stamina, Speed, Strength, Defense, Crossbow, Melee, Casting, Assessment, Armorcraft, Weaponcraft, Barding, Haggling, Lockpick, Scouting, Stealth. 

**The `current` byte is a cache, not the live value.** In real STARTUP.GAM it is 0 for every skill of every character while `max` and `trueSkill` are populated (e.g. Locklear health/stamina max 55/45). BaKGL never reads it: `CalculateEffectiveSkillValue` starts from `trueSkill`, adds the signed `modifier` (recomputed from equipment), then applies affectors, the Drunk condition and (for non-health skills) a current-health scaling, and clamps to per-skill caps. For health and stamina `trueSkill` is therefore the current hit points / stamina and `max` is the ceiling. `effectiveSkill()` in `src/formats/gam.ts` implements this. Item `conditionOrQuantity` is read exactly as BaKGL reads it (raw byte, 0..100 for condition-based items), so an equipped armour showing 23% is stored that way, not misparsed.

(BaKGL also has a computed "TotalHealth" = 0x10, not stored.)

The "selected for improvement" and "unseen improvement" booleans are not in this block; they are event flags: pointer `0x1856 + c*0x11 + skill` (selected) and `0x18ce + c*0x11 + skill` (unseen improvement). Note the `0x11` stride (17), not 16.

### 3.2 Conditions

Seven bytes per character, each 0..100: Sick, Plagued, Poisoned, Drunk, Healing, Starving, NearDeath.

### 3.3 Skill affectors

Eight 14-byte slots: `u16 type` (0 = empty slot), `u16 skill mask` (single bit, bit n = skill n), `i16 adjustment`, `u32 start time`, `u32 end time` (ticks). The meaning of `type` values is not established.

## 4. Inventories

Layout at the inventory address: `u8 itemCount`, `u16 capacity`, then `itemCount` 4-byte item records, followed by `capacity - itemCount` unused 4-byte slots. A character stride of `0x70` leaves room for 27 slots after the 3-byte header, so capacity above 27 would overlap the next character (BaKGL does not guard this). The party key inventory at `0x3aaa4` uses the same layout.

Item record: `u8 itemIndex`, `u8 conditionOrQuantity`, `u8 status`, `u8 modifiers`.

- `itemIndex` indexes the object definitions (OBJINFO.DAT, owned by the items task; see `docs/formats/items.md`). Whether the byte is condition %, charges or a quantity depends on the item's ConditionBased / ChargeBased / QuantityBased flag there.
- `status` bit indices: 1 Activated, 2 Used, 4 Broken, 5 Repairable, 6 Equipped, 7 Poisoned. Bits 0 and 3 are unassigned in BaKGL.
- `modifiers` is a bitmask of item enchantments; the individual bits are not decoded here.

Zone containers (13 regions at `0x3ab4f`...), shops (98 at `0x443c9`, parsed by `src/formats/gdsContainers.ts`, see shops.md) and combat inventories (1734 at `0x46053`) share the inventory encoding but are **not parsed**.

## 5. Time-expiring events (`0x616`)

`u16 count`, then per entry: `u8 type` (0 none, 1 light, 2 spell, 3 set-state, 4 reset-state), `u8 flags`, `u16 data`, `u32 duration`. The block is followed by other data at `0x6b8`, so a plausible maximum is about 19 entries (`(0x6b8-0x618)/8`); BaKGL does not state a limit.

## 6. Event flags

Most game state (quest progress, conversation choices, door state, encounters) is bit flags addressed by a *pointer*, not a byte offset.

Standard pointers (`ptr < 0xdac0`): `bit = ptr & 0xf`, `byte = ((ptr >> 3) & 0xfffe) + 0x6e2`. The flag is bit `bit` of the u16 at `byte`.

Complex pointers (`ptr >= 0xdac0`): `s = (ptr + 0x2540) & 0xffff`, `byte = s/10 + 0xb09`, `bit = (s % 10) ? s%10 - 1 : 0`. The 1-in-10 stepping suggests a 10-bit-per-record packing; this is **UNKNOWN** and may be inexact.

Known pointer bases (from BaKGL `offsets.hpp`): skill selected `0x1856`, skill unseen improvement `0x18ce`, condition state `0x1c98`, items used at least once `0x194c`, lock seen `0x1c5c`, doors `0x1b58`, conversation option inhibited `0x1a2c`, conversation choice marked `0x1d4c`, encounter state `0x190` (count `0x12c0`). The meaning of individual flags comes from the game scripts and is out of scope.

## 7. Other facts from BaKGL

- Active party: at `0x315`, `u8 count` then `count` u8 character indices.
- Party member combat grid positions come from the separate `P1.DAT`, not the save. Not parsed.
- Combat blocks: entity list `0x1383` (700), world locations `0x4fab` (1400), combat stats `0x914b` (1699), grid locations `0x31349` (1699). Not parsed.

## 8. Not yet established

The whole save-file header/title (bytes before `0x5a`), the 2-byte and 6-byte unknown character fields, the 5 unknown location bytes, the heading scale, the affector `type` values, item `modifiers` bits, and the true on-disk size. A real save is needed to confirm that the offsets above land on plausible data (names `Owyn`, gold, chapter 1 at the start).
