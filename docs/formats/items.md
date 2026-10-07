# Items (`OBJINFO.DAT`)

Format notes for the item definition table. Derived from reading `bak/objectInfo.cpp` / `objectInfo.hpp` in [BaKGL](https://github.com/xavieran/BaKGL) to understand the layout; our implementation is `src/formats/objinfo.ts` and is written independently. All values are little-endian. Nothing here has been verified against the real file yet, so treat the layout as "per BaKGL"; items marked **unknown** are kept raw by the parser.

## File layout

1. `138` (`0x8a`) fixed-size item records, 80 bytes each (11,040 bytes).
2. A trailing table of `u16` values read until end of file: scroll prices in royals, indexed by spell number (BaKGL's `GetScrollValue(SpellIndex)`).

The record index is the item id used by inventories and shops.

## Record (80 bytes)

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0x00 | char[30] | `name` | NUL-padded |
| 0x1e | u16 | `unknown1` | **unknown** |
| 0x20 | u16 | `flags` | Behaviour flags; bit meanings **unknown** |
| 0x22 | u16 | `unknown2` | **unknown** |
| 0x24 | i16 | `level` | |
| 0x26 | i16 | `value` | Base price in royals |
| 0x28 | i16 | `strengthSwing` | Weapon damage bonus, swing |
| 0x2a | i16 | `strengthThrust` | Weapon damage bonus, thrust |
| 0x2c | i16 | `accuracySwing` | |
| 0x2e | i16 | `accuracyThrust` | |
| 0x30 | u16 | `imageIndex` | Inventory icon. If 0, the record's own index is used |
| 0x32 | u16 | `imageSize` | Icon size in inventory cells |
| 0x34 | u8 | `useSound` | |
| 0x35 | u8 | `soundPlayTimes` | |
| 0x36 | u8 | `stackSize` | |
| 0x37 | u8 | `defaultStackSize` | |
| 0x38 | u16 | `race` | 0 none, 1 Tsurani, 2 Elf, 3 Human, 4 Dwarf |
| 0x3a | u16 | `categories` | `SaleCategory` bitfield, below |
| 0x3c | u16 | `type` | `ItemType`, below |
| 0x3e | u16 | `effectMask` | |
| 0x40 | i16 | `effect` | |
| 0x42 | u16 | `potionPowerOrBookChance` | Meaning depends on `type` |
| 0x44 | u16 | `alternativeEffect` | |
| 0x46 | u16 | `modifierMask` | High byte: weapon modifier bits (below) |
| 0x48 | i16 | `modifier` | |
| 0x4a | u16 | `dullChance` | Weapon degradation chance |
| 0x4c | u16 | `maxDullAmount` | |
| 0x4e | u16 | `minCondition` | Minimum durability |

## Enumerations

`type`: 0 Unspecified, 1 Sword, 2 Crossbow, 3 Staff, 4 Armor, 7 Key, 8 Tool, 9 WeaponOil, 0xa ArmorOil, 0xb SpecialOil, 0xc Bowstring, 0xd Scroll, 0x10 Note, 0x11 Book, 0x12 Potion, 0x13 Restoratives, 0x14 ConditionModifier, 0x15 Light, 0x16 Ingredient, 0x17 Ration, 0x18 Food, 0x19 Other. Values 5, 6, 0xe, 0xf are not named by BaKGL (**unknown**); the parser keeps `type` as a plain number for that reason.

`categories` bits: 0x1 Utility, 0x2 Rations, 0x4 PreciousGems, 0x8 Keys, 0x10 All, 0x20 QuestItem, 0x40 UsableMundaneItem, 0x80 Sword, 0x100 CrossbowRelated, 0x200 Armor, 0x400 UsableMagicalItem, 0x800 Staff, 0x1000 Scroll, 0x2000 BookOrNote, 0x4000 Potions, 0x8000 Modifier. (Jewellery is 0, i.e. no bits set.)

Weapon modifiers: bit `n` of `modifierMask >> 8` enables entry `n` of Flaming, SteelFire, Frost, Enhancement1, Enhancement2, Blessing1, Blessing2, Blessing3.

## Icons

Per BaKGL's `Icons` loader, `INVSHP1.BMX` and `INVSHP2.BMX` are appended into one image list drawn with `OPTIONS.PAL`, and `imageIndex` indexes that combined list directly (INVSHP2 images follow the last INVSHP1 image). Each image has its own width and height. Implemented in `src/data/itemIcons.ts`; not yet verified against the real files.

## Open questions

- Meaning of `unknown1`, `unknown2` and the bits of `flags`.
- Exact semantics of `effectMask`/`effect` and whether `imageSize` counts cells or pixels.
- Not yet checked against the real `OBJINFO.DAT`: the `0x8a` count and that the trailing table is whole `u16`s.

## Using items (game rules in `src/game/itemUse.ts`)

These are our own provisional rules, not decoded from the original; `flags`, `effectMask` and `effect` are still unknown.

- OBJINFO has no weight field, so the carry limit is the per-character slot count (`inventory.capacity`); stacks hold up to `stackSize`.
- Equipment groups: Sword and Staff share one melee slot, Crossbow and Armor each have one. Broken items cannot be equipped.
- Ration/Food clear Starving. Potion heals Health by `potionPowerOrBookChance` (10 when 0), capped at the maximum; Restoratives also clear Poisoned and Sick. Each use consumes one from a stack. Scrolls and books are refused until spells and the text viewer exist.
- Repair: any Tool in the active party; success chance is the owner's Weaponcraft (Armorcraft for armour) clamped to 5..95 percent; success adds 25 condition and clears Broken on repairable items; the tool loses 10 condition either way.
- Inventory keys: Enter/U use, X equip/unequip, T give to the next character, R repair; right click uses the slot under the cursor.
