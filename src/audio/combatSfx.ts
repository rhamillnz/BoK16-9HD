import type { BattleEvent, Fighter } from '../combat/battle';
import { playSfx } from './sfxBus';
import { attackHitSound, Snd } from './soundIds';

/**
 * Sounds for the events one combat action produced, in order. A hit uses the attacker's melee
 * sound and a miss the swing sound (BaKGL notes the thrust-miss sound is absent from the data files).
 * Crossbow shots reuse the sword hit and the swing: no separate sound is documented.
 */
export function battleEventSounds(events: readonly BattleEvent[], fighters: readonly Fighter[]): number[] {
  const monsterOf = (id: string) => fighters.find((f) => f.id === id)?.monster ?? 0;
  const out: number[] = [];
  for (const e of events) {
    if (e.type === 'attack') {
      if (e.hit) out.push(attackHitSound(monsterOf(e.attacker)));
      else out.push(Snd.missSwing);
    } else if (e.type === 'shoot') {
      out.push(e.hit ? Snd.swordHit : Snd.missSwing);
    }
  }
  return out;
}

export function playBattleSounds(events: readonly BattleEvent[], fighters: readonly Fighter[]): void {
  for (const id of battleEventSounds(events, fighters)) playSfx(id);
}
