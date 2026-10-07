# Skill improvement by practice

Derived from reading BaKGL (`bak/skills.cpp`, `DoImproveSkill`) for understanding; implemented independently in `src/game/practice.ts`.

Each skill keeps a `trueSkill` level and an `experience` byte. Practising adds experience; every 256 points is one level.

Experience for one practice, by kind:

- **exercised** (normal use): `((v1 - v2) * trueSkill / 100) + v2`, times the multiplier when it is not 0. `v1`/`v2` are per-skill constants (health 3/0x33, stamina 3/0x33, speed 1/8, strength 1/8, defense 2/8, crossbow 3/0x33, melee 1/8, casting 3/0x33, assessment 8/0, armorcraft 5/0, weaponcraft 5/0, barding 0x20/0x80, haggling 2/0x20, lockpick 3/0x33, scouting 8/0, stealth 1/0x40). Higher skill gives fewer points for most skills.
- **direct**: the multiplier is the experience. **fraction**: `trueSkill * m / 100`. **difference**: `(100 - trueSkill) * m`.

Selected skills (ticked on the character sheet) get a bonus of `xp * pool / 52`, where `pool = 26 / number of selected skills` for that character.

Result: leftover experience is `(old + xp) % 256`; `trueSkill += (old + xp) / 256`, clamped to 1..250 for strength/speed/health/stamina (speed/strength minimum 1) and 0..100 for the rest; `max` rises to match; the unseen-improvement flag is set when the level changed. A skill with `max == 0` (the character does not have it) never changes.

Known practice triggers (from the game itself, partly inferred): a haggle attempt exercises Haggling when `HaggleResult.exercised` is set (a success always, a failure with chance `(100 - roll) / 5` percent); repairs exercise Armorcraft or Weaponcraft; a lockpick attempt that sets `learned` and every hand disarm of a trapped chest exercise Lockpick. Combat pass 2 is expected to call `practiceCharacter` for melee/crossbow/defense. Which other actions raise which skills is *not* established here.
