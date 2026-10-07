# Camping in the wild

Implemented in `src/game/camp.ts` (rules) and `src/game/campControls.ts` (R key and the choice boxes). Rest time maths is shared with `docs/formats/gamestate.md` (`restOneHour`, `REST_PARAMS.camp`). Items marked *estimate* were not read from the original.

- **Opening**: R in the wild (not in a town, a fight, a dialogue or a screen) shows a choice box: rest 1 hour, 4 hours, until morning (06:00), until healed, or break camp. The box lists the time, the rations carried and how many characters are hurt.
- **Time**: always whole one-hour steps, as the original ignores longer deltas. Each step calls `restOneHour(world, false)`, which stamps time-last-slept. Day boundaries eat rations and improve NearDeath, per `gamestate.md`.
- **Healing per hour**: camp parameters are fraction `0x64`, ceiling `0x50`. Each active character gains `floor(fraction / 100)` health (doubled with the Healing condition), never past 80 percent of maximum health. Stamina returns to full after an hour of rest (*estimate*).
- **Rations**: at a day boundary each active character eats one Ration item (type `0x17`), their own first, then a companion's. Eating clears Starving. With none left the character gains 5 Starving. Spoiled and poisoned rations are not modelled.
- **NearDeath**: -10 per day boundary (*estimate*).
- **Sick**: a camp longer than 13 hours cures it (`REST_CURES_SICK_AFTER`).
- **Every 30th day**: +1 maximum health and stamina, from the time report.
- **Interruptions**: each hour but the last has a 4 percent chance (*estimate*) of an ambush that ends the camp early. The host's optional `onInterrupted` hook can start a fight; main.ts does not wire one yet because random wilderness encounter tables are not parsed.
- **Not modelled**: sleep damage (only applies awake), light and spell expiry, guards or watches, camping needing a safe spot.
