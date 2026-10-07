# Temples: curing, blessing, teleporting

Implemented in `src/game/temple.ts` (rules), `src/game/templeFlow.ts` (screens and dialogue flow), `src/formats/gdsShops.ts` and `src/formats/req.ts` (data). Derived from reading BaKGL (`bak/temple.cpp`, `bak/shop.cpp`, `bak/save/containers.cpp`, `bak/layout.cpp`, `gui/temple/*`, `gui/teleportScreen.cpp`, `gui/gdsScene.cpp`) for understanding only; no code copied. Items marked *unverified* have not been checked against the original game.

## Where a temple's numbers come from

A temple is a GDS scene (see `towns.md`) whose `templeIndex` byte has bit 0x80 set; the low 7 bits are the **temple number** 1 to 12 (4 = Temple of Sung, 12 = Chapel of Ishap). Its prices live in the save, in the table of 98 **town containers** at `0x443c9` (the same table shops and inns use):

```
record:  u32 x? (4 bytes unknown)  u32 gdsNumber  u32 letterIndex     12-byte location
         u8 type  u8 itemCount  u8 capacity  u8 flags
         max(itemCount, capacity) x 4-byte item slots
         then, in this order and only when the flag bit is set:
           0x01 lock (4 bytes)   0x20 door (2)   0x02 dialogue (6)   0x04 shop stats (16)
           0x08 encounter (9)    0x10 last-accessed time (4)
```

The letter index maps to a scene letter like the town tables do (0 and 1 are both A). Records vary in size, so the whole table is walked from the start.

Shop stats (16 bytes): `u8 templeNumber, sellFactor, maxDiscount, buyFactor, haggleDifficulty, haggleAnnoyance, bardingSkill, bardingReward, bardingMaxReward, unknown, innSleepTilHour, innCost, repairTypes, repairFactor; u16 categories`. A temple reuses the shop fields:

| Field | Temple meaning |
|---|---|
| `sellFactor` | fixed blessing cost (x10 royals) |
| `maxDiscount` | blessing cost percent of the item's value |
| `buyFactor` | blessing level 1 to 3 |
| `haggleDifficulty` | cure cost factor (percent) |
| `haggleAnnoyance` | teleport cost multiplier |
| `categories` | teleport cost constant |

## The temple hotspot

Action 0xD does not play the hotspot's dialogue as a plain click; the dialogue is the temple's main menu and its **query choice** says what the player wants: 269 Talk (play it again), 272 Cure, 271 Bless, 268 Done. A `SetEndOfDialogState` of -1 in that dialogue means the service is refused; the menu comes back. Fixed dialogue keys (all in the shared dialogue files): main 0x13d668, cure cannot-heal 0x13d66b (Sung) / 0x13d673, cannot afford 0x13d66c, post-healing 0x13d66e, bless already blessed 0x13d66f, bless cost 0x13d670, cannot bless 0x13d671. Our screens use their own text for costs and results; only the main dialogue, the cannot-heal pair and the post-heal / post-teleport dialogues are played.

## Cure

Cost for one character, in royals: for every condition except Healing with a value above 0 add `value * rate + 10`, with rates by condition `[sick 4, plagued 10, poisoned 10, drunk 3, healing 0, starving 2, nearDeath 30]`; multiply the sum by the cure factor and divide by 100 (integer). The Temple of Sung adds `(max health + max stamina) - (current health + current stamina)` using effective skills. A character costing 0 is skipped; if nobody costs anything the "cannot heal" dialogue plays.

Cure: every condition drops by 100 (cleared), Healing rises by 20; the Temple of Sung then restores health and stamina in full and raises Healing by 100 (to the cap). The original shows a portrait panel per character with Cure, Next player and Done; ours is the generic menu panel (`src/ui/menuScreen.ts`) with the same three buttons.

## Bless

Only swords (item type 1) and armour (type 4) can be blessed. Price: `sellFactor * 10 + floor(value * maxDiscount / 100)` royals, at least 1. The blessing sets item modifier bit `4 + buyFactor` (0x20, 0x40 or 0x80, "Blessing 1 to 3") and clears any earlier blessing bit first. Blessed items sell for 1.5, 1.75 or 2 times the base value in shops. The original refuses when money is not strictly above the price; we allow paying exactly what the party has (*deliberate difference*).

## Teleport

Action 0xB. Temples are marked **seen** when their scene opens with an active teleport hotspot: event flag `0x1950 + temple`. The teleport screen needs at least two seen temples (otherwise the "no destinations" dialogue, 0x13d65f). BaKGL lists every temple as reachable (its seen check is commented out); we list only seen ones (*unverified*).

Destination temple n sends the party to entry n-1 of `TELEPORT.DAT` (see `dialogue.md`; it carries the zone, position and the temple scene to enter). Cost from temple `s` to temple `d`, using their spots on the teleport map (the `x`, `y` of widgets `s-1` and `d-1` in `REQ_TELE.DAT`, widget-local pixels): `dx, dy` are the absolute differences, `distance = max + floor(min * 3 / 8)`, `cost = floor(((distance * multiplier + constant) * 10 + 5) / 10)` with the source temple's multiplier and constant. Chapter 6 closes the Chapel of Ishap as source and destination until event flag `0x1ed4` is set (dialogues 0x493fe source, 0x493fd destination).

## REQ layouts (`REQ_*.DAT`)

Request panels used by the original UI. Header (30 bytes): 2 skipped, `i16 popup`, 2 skipped, `i16 x, y, width, height`, 2 skipped, `i16 offsetX, offsetY`, 8 skipped, `u16 widgetCount`. Each widget is 33 bytes: `u16 widget, i16 action, u8 visible`, 6 skipped, `i16 x, y`, `u16 width, height`, 2 skipped, `i16 labelOffset, i16 teleport`, `u16 image` (stored as `(image >> 1) + (image & 1)`), 2 skipped, `u16 group`, 2 skipped. After the widgets: 2 skipped bytes, then NUL-terminated labels addressed by `labelOffset` from there (negative = none). `REQ_TELE.DAT` has one widget per temple (in order) plus Cancel; its labels are the temple names. Only the fields above are used.

## Not done

The original draws portraits, the SCX backgrounds and the teleport map; the menu panel here is a plain list. Temple sound effects (cure 0xc, bless 0x3e, teleport) wait for the sound-effect item.
