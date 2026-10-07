# Shops and haggling

Shops, inns, temples, barmaids and bards are all **containers** attached to a town scene. Their records live in the save image (`STARTUP.GAM`), not in a separate data file. The rules below are described from xavieran/BaKGL (GPL-3, read for understanding only; this is our own wording). Code: `src/formats/gdsContainers.ts` (parser), `src/game/shops.ts` (rules), `src/game/shopControls.ts` (flow), `src/ui/shopScreen.ts` and `src/ui/shopHudScreen.ts` (screen).

## 1. Where the records are

98 variable-length records start at `0x443c9`. Record layout:

| Size | Field |
|---|---|
| 4 | unknown |
| u32 | scene number (low byte used) |
| u32 | scene letter index (0 and 1 are both `A`, 2 is `B`, ...; same rule as `gdsLetter`) |
| u8 | location type (unknown) |
| u8 | item count |
| u8 | capacity |
| u8 | flags: 0x01 lock, 0x02 dialog, 0x04 shop, 0x08 encounter, 0x10 time, 0x20 door |
| capacity x 4 | inventory slots (`itemIndex, conditionOrQuantity, status, modifiers`); only the first `item count` are used |
| 4 | lock (if flag 0x01) |
| 2 | door index (0x20) |
| 6 | dialog: context var, order, u32 key (0x02) |
| 16 | shop stats (0x04), below |
| 9 | encounter (0x08) |
| 4 | last-accessed time (0x10) |

Parts follow in the order lock, door, dialog, shop, encounter, time. A scene is found by matching its number and letter.

## 2. Shop stats (16 bytes)

`u8 templeNumber, sellFactor, maxDiscount, buyFactor, haggleDifficulty, haggleAnnoyance, bardingSkill, bardingReward, bardingMaxReward, unknown, innSleepUntilHour, innCost, repairTypes, repairFactor; u16 categories`.

Fields are shared between uses: for a temple `sellFactor` is the fixed blessing cost, `maxDiscount` the blessing percent, `buyFactor` the blessing type (modifier `4 + value`) and `haggleDifficulty` the heal factor. `repairTypes` bits: 1 swords, 2 armour, 4 crossbows. `categories` is a `SaleCategory` bit set (see items.md): the shop buys items whose categories intersect it, and anything it already stocks.

## 3. Prices (royals; 10 royals = 1 sovereign)

- Item flags used (`ItemDef.flags`): `0x0800` stackable, `0x1000` condition based, `0x2000` charge based, `0x8000` quantity based.
- Quantity multiple of an item: stackable or charge based, `quantity / defaultStackSize`; condition based, `condition / 100`; otherwise 1.
- **Sell price** (what the party pays): per unit `(100 + sellFactor)/100 * value`, where value is raised by blessings (modifier bits 5, 6, 7: x1.5, x1.75, x2). Scrolls use the trailing scroll price table of OBJINFO instead (indexed by the spell stored in the item's quantity byte). A haggle discount (royals) comes off the unit price, never below one royal. Result is rounded after multiplying by the quantity multiple.
- **Buy price** (what the shop pays): `buyFactor/100 * sellPrice(undiscounted)`, rounded; armour fetches half.
- Romney guild war: in zone 3 at the shop whose `templeNumber` is 2, while event flag `0xdc29` is set and `0xdc2a` is clear, sell prices are multiplied by 6.
- Shops never run out of stock when the party buys. Sold items are added to the shop (stackable ones merge) unless the shop is full.
- A purchase moves one default stack of stacking or charge-based items, and one item otherwise.

## 4. Haggling

Only the sell side. A roll for skill `s` is the best of three `random(0..0xfff) % s`.

1. A shop with `maxDiscount == 0` never haggles; scrolls cannot be haggled.
2. If the item already has a discount this visit, the attempt can only fail.
3. Otherwise roll the character's effective Haggling against `haggleDifficulty`; the margin is `max(0, skillRoll - shopRoll)`. A margin of 0 is a failure.
4. On success: `discount% = clamp(roll(((maxDiscount - remainder) >> 1) + margin), 0, maxDiscount)` where `remainder` is the fractional part of the shop's base value in hundredths; the royal discount is `basicValue * discount% / 100`. The party's Haggling skill is exercised.
5. On failure the skill may be exercised (chance `(100 - skillRoll) / 5` percent), and with `haggleAnnoyance` percent chance the shopkeeper refuses to sell that item for the rest of the visit.

Our code reports `exercised` in the result but does not apply skill practice yet (backlog item 8).

## 5. The screen and its dialogues

Opening a shop hotspot (action 6) shows the stock and the active character's pack. Dialogue keys played (all in the shared dialogue file): `0x1b7757` buy offer (answers Accept `0x104`, Haggle `0x106`, or decline), `0x1b7756` sell offer, `0x1b7755` haggle won, `0x1b7754` haggle failed or item withdrawn, `0x1b7758` cannot afford, `0x1b7759` shop won't buy, `0x1b775c` too drunk for ale or brandy, `0x1b7748` no room, `0x1b774e` cannot sell the only weapon, `0x1b775f` cannot haggle over a scroll. The price shown in those dialogues is the item-value text variable (`@` code 18 in textVariables.ts), which `shopControls` fills in before each one. Sold items and the shop's statistics are saved with the game (`SaveGameData.shops`).

Not done: repair shops (action 0x10 / 0xA), buying a chosen quantity, the Lua-scripted haggle texts BaKGL adds, and the stock-changing events of later chapters.
