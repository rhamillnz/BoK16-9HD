# Combat and rules audit against BaKGL

Findings from reading BaKGL (`bak/combat/calculations.cpp`, `game/combat/combatManager.cpp`, `bak/skills.cpp`, `bak/gameState.cpp`, `bak/combat/spellEffects.cpp`) next to our `src/combat/rules.ts`, `rewards.ts`, `roster.ts` and `src/game/spells.ts`. Written in our own words; BaKGL is reference only. "Checked" means we match BaKGL; BaKGL itself has not been checked against the original game, and its author marks a few spots as doubtful. Table-driven tests: `tests/combat-rules.test.ts`, `tests/combat-audit.test.ts`.

## Hit chance (matches, plus gaps fixed)

| Rule | BaKGL | Ours |
|---|---|---|
| Roll | 0-99, +20 if the defender is defending | same |
| Weapon accuracy | thrust or swing accuracy, adjusted by race pair (`-1`/`-2`), then scaled by the weapon's condition; a weapon that is not condition-based (a staff) counts as 100 | same (**staff rule added**) |
| Score | `Melee + weapon bonus`, then times the weapon's blessing (105/110/115 percent), minus parry, clamped 2..98 | same (**blessing added**) |
| Parry | `Defense / 4`, 0 if the defender cannot act, then times the armour's blessing, clamped 0..98 | same (**blessing added**) |
| Hit | roll < score | same |

The blessing byte is the inventory item's `modifiers` (bit 5, 6, 7 = Blessing 1, 2, 3; the highest set bit wins).

## Damage (matches, plus gaps fixed)

- Base: `Strength + weapon strength * condition / 100`, at least 1. Thrust uses the thrust strength, slash the swing strength. Same.
- **Added**: bonus damage from the weapon's enchantments, on top of the base. Poisoned blade +10; an enchantment replaces it (the last one set wins, in bit order): Flaming 75 percent of the weapon strength, Steel Fire 100, Frost 50, Enhancement 1 200, Enhancement 2 75 (percent of the raw thrust or swing strength, not scaled by condition). Armour carrying the same enchantment cancels the bonus; poisoned armour cancels a plain poison bonus only. Implemented in `bonusDamage`.
- **Added**: Guarda Revanche (item 22) doubles the total against moredhel (monsters 18 and 21).
- Armour: reduction = `Defense / 4 + condition * rating / 100`, times the race effect, capped at 98 percent; no armour means no reduction (even the Defense part). A hit that armour would cancel still does 1 or 2. Same.
- Stamina absorbs damage first, the rest comes off Health. A combatant at 0 Health is dead and is left at 0 Health and 0 Stamina with Near Death 100. Same (see Wounds).
- **Not applied (still open)**: BaKGL halves all damage to a list of monsters flagged in `sMonsterResistanceArr` and adds 50 percent for a few named weaknesses (Brak-Nurr, pantathian, troll, wyverns and others, keyed by modifier flags). The resistance table is marked "triple check this" by its author and ignores which modifier is involved, so applying it would change balance on unchecked data. Revisit when real monster fights can be compared.
- Not applied: spell shields (Hocho's Haven, Skin of the Dragon, Dannon's Delusions) and poison ticks; none of those spells are cast in combat yet.
- **Slash cost**: BaKGL needs more than 1 Health plus Stamina combined to slash and the code comment says a slash costs 1 Stamina; the same code path actually damages the *target* by 1 with no armour before the roll, which looks like a BaKGL slip. We keep the attacker paying 1 Stamina (**unverified**) but use BaKGL's gate, see below.

## Wear (fixed)

BaKGL wears items only through `UseCombatItemAndDull`, called per melee attack:

1. Hit: the attacker's sword (not a staff) and the defender's armour.
2. The roll: with the item's `dullChance` percent the item loses `1 .. maxDullAmount-1` points (always 1 when the maximum is 1; **our earlier code used 1..maxDullAmount**).
3. The loss is multiplied by 128/256 for a thrust and 256/256 for a slash and for armour, rounded down, so a thrust that rolls 1 wears nothing.
4. A crossbow also snaps to 0 when a 0-49 roll is at or above its new condition.
5. The result never drops below the item's minimum condition; 0 is broken. The item is marked used and repairable.

Replaced the invented "armour loses 1 per two hits taken". Open: on a miss against a defender who is not actively defending BaKGL also dulls the attacker's sword; its author notes this looks backwards, so we do not copy it. Crossbow wear for our shots reuses the same function (**our extension**, BaKGL has no ranged attack).

## Skill gains (fixed)

BaKGL practises skills attack by attack, win or lose, using the `fraction` kind (skill * 3 / 100 experience, see practice.md):

- Every attack: attacker Melee, defender Defense.
- Hit: attacker Melee again and Strength.
- Miss: defender Defense twice more (three in total).

There is no experience for kills or for being hit, and no experience at the end of a fight. Replaced the earlier stand-ins (2 per hit, 1 per hit taken, maximum Health / 5 per kill; win only) with `applyCombatPractice`, applied on every outcome. Kept as **our own** stand-ins because BaKGL has no ranged or casting fights: 2 Crossbow experience per shot landed and 2 Casting experience per cast, and the small royals purse from slain enemies (win only).

## Spell costs

- Affordability: BaKGL allows a spell when Health + Stamina (the effective total) is **at least** the minimum cost; we required strictly more. Fixed (`canCast`, `castableSpells`).
- Power range offered: `minCost .. min(maxCost, total Health + Stamina)`. We stop one short so the caster always keeps 1 point (BaKGL lets the total reach 0, which sets Near Death 100; its own comment says the resulting Health value is not always right). Kept the floor, **unverified**.
- Payment takes the points off the combined pool, Stamina first. BaKGL then re-normalises the pool, putting Health back up to its maximum from leftover Stamina (a wounded caster ends with less Stamina and more Health than ours). Same total; not copied.
- BaKGL implements only the timed "static" spells (lights etc., one hour of game time per point of power). Everything about damage and healing spell amounts, enemy casting, and combat casting experience is our own and stays **unverified**.

## Wounds

On death BaKGL zeroes Health and Stamina, clears spell effects and sets Near Death to 100. Ours matches (`applyBattleToParty`). Health and Stamina are written back after the fight. Dead party members are revived after a defeat by our own flow.

## Effective skills

`effectiveSkill` already follows `CalculateEffectiveSkillValue` (affectors, drunk, health effect, caps 500/200/100, absolute max 250). Checked; Sick/Plagued style condition effects other than drunk are not in the table we read.

## Still open

Monster resistances and weaknesses, spell shield and poison effects in combat, the retreat direction calculation, and what a miss should wear. None can be settled from BaKGL alone.
