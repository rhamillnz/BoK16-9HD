# Inns and resting

Read from xavieran/BaKGL (`gui/camp/campScreen.cpp`, `bak/time.cpp`, `bak/container.cpp`, `bak/shop.cpp`, `bak/save/containers.cpp`) to understand them, and described here in our own words. Our code: `src/formats/gdsContainers.ts` (from the shops work), `src/game/inn.ts`, `src/game/rest.ts`, `src/game/dialogState.ts`.

## Where an inn's data lives

An inn hotspot (action 7) has no price of its own. Prices and wake-up hours are in the **GDS container** of the scene, one of 98 variable-length records in the save image starting at `0x443c9` (`STARTUP.GAM` has them; they are not in the resource archive).

Record layout (all little-endian):

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | unknown |
| 4 | u32 | scene (town) number; only the low byte is used |
| 8 | u32 | scene letter index, as `gdsLetter` (0 and 1 are 'A') |
| 12 | u8 | location type |
| 13 | u8 | item count |
| 14 | u8 | capacity |
| 15 | u8 | flags: 0x01 lock, 0x02 dialogue, 0x04 shop, 0x08 encounter, 0x10 time, 0x20 door |
| 16 | capacity x 4 | inventory slots (item, condition or quantity, status, modifiers); unused slots still take 4 bytes |

Optional blocks follow in this order when their flag is set: lock (4 bytes), door (2), dialogue (6), **shop stats** (16), encounter (9), last-accessed time (4).

Shop stats (shops, inns, temples and bards share the block): `templeNumber`, `sellFactor`, `maxDiscount`, `buyFactor`, `haggleDifficulty`, `haggleAnnoyanceFactor`, `bardingSkill`, `bardingReward`, `bardingMaxReward`, one unknown byte, **`innSleepUntilHour`**, **`innCost`** (sovereigns), `repairTypes`, `repairFactor`, `u16 categories`.

`parseShopContainers` walks the records and `findShop(shops, ref)` looks a scene up (`src/formats/gdsContainers.ts`, see shops.md). Not verified against real data in the cloud (synthetic fixtures only).

## The visit

1. Clicking the inn hotspot plays its own dialogue (if any), then the Inn action runs. A dialogue end state that maps to "inn" (see towns.md) also lands here.
2. Chapter 5 only: the cost is overridden before the screen opens, 0x48 sovereigns until event flag `0xdb1c` is set, then 0xa.
3. The innkeeper's dialogue is the fixed key `0x13d672` for every inn. Before it plays the game sets scripted state it reads: context `0x7530` is 0 on arrival and 1 once the party has slept, `0x753e` item value is the price in royals (also the money text variable), `0x7531` money is the party's whole sovereigns, `0x7533` is 1 when the party's money is strictly greater than the price, `0x7542` shop type. These live in `ScriptedState` (`src/game/dialogState.ts`) and `choiceValue` falls back to it.
4. The player accepts unless the dialogue ended with end state -1 or the last answer was No.
5. Accepting sleeps until `innSleepUntilHour` (a whole day if it is already that hour), one hour at a time, with the inn heal parameters. The price is charged **after** the night.
6. Afterwards, if anybody can still heal (health + stamina below the full pool), the dialogue is offered again with context 1; otherwise the scene closes. Declining ends it.

Our version has no sleep screen yet: the night is applied at once and a short notice reports the hours slept. (The original draws a clock with the party's health and rations while time passes, and can interrupt for events.)

## Resting maths (`src/game/rest.ts`)

Every rest step is exactly one hour. Heal parameters per hour: inn fraction `0x85` ceiling `0x64`, camp `0x64` / `0x50` (80 percent).

Per hour, each active character, in this order:

- Resting only: Sick drops by 3. Heal amount is `floor(fraction / 100)` (1 at both rates), doubled under Healing.
- For each condition above 0, it changes by a fixed amount per hour: Sick +1, Plagued +1, Poisoned +1, Drunk -2, Healing -3, Starving 0, Near Death 0. Healing slows the three sicknesses (2 less, Sick 3 less). While a condition is still above 0 it adds to the heal amount: Sick -1, Plagued -2, Poisoned -3, Healing +1, Starving -2.
- The heal amount changes the **health pool**, health plus stamina as one number (health fills first, stamina holds the overflow). Positive amounts raise the pool up to 80 or 100 percent of the maximum pool, never lowering it. Near Death replaces that cap with `(100 - nearDeath) * 30 / 100 + 1`. Zero or negative amounts subtract; reaching 0 sets Near Death to 100.

Day boundary: every 30th day +1 to health and stamina (we raise the maximum too, *unverified*); each character eats a ration (item 72 clears Starving; spoiled 74 clears Starving and adds Sick 3; poisoned 73 adds Poisoned 4; none adds Starving 5); Near Death improves by `(nearDeath - 100) / 10 - 1`, doubled under Healing. Awake 18 hours: health damage per hour by character index 2, 1, 2, 2, 2, 3 (the 17 hour need-sleep warning is not shown). Resting more than 13 hours in one go clears Sick. `canHeal` is pool below the full pool in an inn and below 80 percent camping.

Note: the camping module (`camp.ts`) came first and uses a simpler health-only model with estimated stamina recovery; it was left alone, `rest.ts` is the faithful one and the two can be unified later.
