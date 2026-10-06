# Game clock and world state

Implemented in `src/game/state.ts`. Derived from reading BaKGL `bak/time.cpp`, `bak/constants.hpp` and the camp screen; no code copied. Items marked *unverified* have not been checked against the original game.

## Time units

World time is a `u32` tick count (save offset `0x6a`). One tick is 2 game seconds: 30 ticks per minute, `0x708` (1800) per hour, `0xa8c0` (43200) per day. Tick 0 is midnight, so `minutesSinceMidnight = (ticks % 0xa8c0) * 2 / 60`, which is what `SkyDome.update` takes. Named durations in `TIMES` match the original constants (half hour `0x384`, 13 h `0x5b68`, 17 h `0x7788`, 18 h `0x7e90`).

## Time step (`advanceTime`)

The original compares day and hour-of-day before and after the step:

- **Day changed:** every 30th day active characters gain +1 health and stamina; when the caller allows it, each active character eats a ration (a ration clears Starving, spoiled rations add Sick, poisoned rations add Poisoned, no food adds 5 Starving); NearDeath improves.
- **Hour changed:** if awake and a dialog is allowed, 17 h since the last sleep shows a need-sleep warning and 18 h damages each character's health (per character -2,-1,-2,-2,-2,-3 in character order); per-hour condition effects run with the heal parameters.
- Always: expired skill affectors (`endTime < now`) are dropped, and expiring events count down.

`advanceTime` returns the new state plus a `TimeReport` of the above; it does not touch characters. A step of exactly 24 h shows a day change but no hour change, as in the original.

## Expiring events

Entries from save `0x616`. Duration reduces by the step and is clamped at 0; at 0 a SetState (type 3) event sets its event flag to 1, a ResetState (type 4) sets it to 0, and every entry at 0 is removed. Light and spell types are re-evaluated every step in the original; here they are only counted down (*their side effects are not modelled*).

## Resting

`restOneHour` always advances exactly one hour (the original ignores the requested delta), then stamps time-last-slept. Heal parameters per hour: inn `0x85` fraction / `0x64` ceiling, camp `0x64` / `0x50`. Base heal is `floor(fraction/100)` health per hour, doubled under the Healing condition, before condition-based adjustments (*not modelled*). Resting more than 13 h in one session cures Sick. Resting to a target hour is a loop of one-hour steps; `hoursUntil` gives the count.

## Event flags

`getFlag` and `setFlag` use the pointer scheme in `savegame.md` §6; `setFlag` returns a new state with a copied byte image.
