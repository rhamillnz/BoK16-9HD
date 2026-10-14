# Camping in the wild

Implemented in `src/game/camp.ts` (rules) and `src/game/campControls.ts` (R key and the choice boxes). Rest time maths is shared with `docs/formats/gamestate.md` (`restOneHour`, `REST_PARAMS.camp`). Healing, conditions, near death and growth now come from the inn rules in `src/game/rest.ts` (`applyTimeReport`), so a camp and an inn heal the same way; camping adds rations shared across the party. Items marked *estimate* were not read from the original.

- **Opening**: R in the wild (not in a town, a fight, a dialogue or a screen) shows a choice box: rest 1 hour, 4 hours, until morning (06:00), until healed, or break camp. The box lists the time, the rations carried and how many characters are hurt.
- **Time**: always whole one-hour steps, as the original ignores longer deltas. Each step calls `restOneHour(world, false)`, which stamps time-last-slept. Day boundaries eat rations and improve NearDeath, per `gamestate.md`.
- **Healing per hour**: camp parameters are fraction `0x64`, ceiling `0x50`. Each active character gains `floor(fraction / 100)` pool points (doubled with the Healing condition), never past 80 percent of the pool maximum. Health and stamina are one pool (health fills first), as in inns; there is no separate stamina refill. Near death eases by the shared daily rule.
- **Rations**: at a day boundary each active character eats one Ration item (type `0x17`), their own first, then a companion's. Eating clears Starving. With none left the character gains 5 Starving. Spoiled and poisoned rations are not modelled.
- **NearDeath**: the shared daily rule from inns (a tenth of the distance from 100, less one; doubled under Healing).
- **Sick**: a camp longer than 13 hours cures it (`REST_CURES_SICK_AFTER`).
- **Every 30th day**: +1 maximum health and stamina, from the time report.
- **Interruptions**: none by default. The original has no random encounters and BaKGL's camp has no interruption, so the earlier 4 percent per hour *estimate* was dropped (it only cut camps short). `campFor` still takes an `ambushChance`, and the host's optional `onInterrupted` hook could start a fight.
- **Not modelled**: sleep damage (only applies awake), light and spell expiry, guards or watches, camping needing a safe spot.
