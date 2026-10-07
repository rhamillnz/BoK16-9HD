import type { SpellDef } from '../formats/spells';
import { activeCharacters, updateCharacter, type PartyState } from './party';
import { formatTime } from './state';
import {
  canCast, castHeal, currentLight, isSpellcaster, knownSpells, maxPower, payCost, spellKind, spellTicks,
  type ActiveLight,
} from './spells';

/** What casting in the world needs from the running game. */
export interface CastHost {
  spells: readonly SpellDef[];
  getParty(): PartyState;
  setParty(p: PartyState): void;
  /** Current world time in ticks. */
  getTicks(): number;
  /** False while a screen, dialogue, town scene, fight or zone change owns the game. */
  canCast(): boolean;
  /** Show text with choices (or none) and resolve to the picked index, -1 when dismissed. */
  menu(text: string, choices: string[]): Promise<number>;
  /** The light in force changed (undefined: dark). Lets the renderer brighten the party's surroundings. */
  onLight?(light: ActiveLight | undefined): void;
}

/** Powers offered for a spell: its cheapest, middle and strongest affordable. */
export function powerChoices(min: number, max: number): number[] {
  return [...new Set([min, Math.round((min + max) / 2), max])].filter((p) => p >= min && p <= max);
}

/**
 * Cast a spell outside combat: pick the caster, the spell, its power and (for healing) the target.
 * Resolves to a message, or undefined when cancelled. Combat spells are not offered here.
 */
export async function runCast(host: CastHost, lights: ActiveLight[]): Promise<string | undefined> {
  const party = host.getParty();
  const casters = activeCharacters(party).filter((c) => isSpellcaster(c) && knownSpells(c, host.spells).some((s) => ['heal', 'light'].includes(spellKind(s))));
  if (casters.length === 0) {
    await host.menu('Nobody in the party knows a spell that works here.', []);
    return undefined;
  }
  const who = casters.length === 1 ? 0 : await host.menu('Who casts?', [...casters.map((c) => c.name), 'Cancel']);
  const caster = casters[who];
  if (!caster) return undefined;

  const options = knownSpells(caster, host.spells).filter((s) => ['heal', 'light'].includes(spellKind(s)) && canCast(caster, s));
  if (options.length === 0) {
    await host.menu(`${caster.name} is too weary to cast.`, []);
    return undefined;
  }
  const si = await host.menu(`${caster.name} (${caster.skills.stamina.trueSkill} St, ${caster.skills.health.trueSkill} HP)`, [...options.map((s) => `${s.name} (${s.minCost}-${s.maxCost})`), 'Cancel']);
  const spell = options[si];
  if (!spell) return undefined;

  const top = maxPower(caster, spell);
  const powers = powerChoices(spell.minCost, top);
  const pi = powers.length === 1 ? 0 : await host.menu(`${spell.name}: how much power?`, [...powers.map((p) => `${p} points`), 'Cancel']);
  const power = powers[pi];
  if (power === undefined) return undefined;

  let message: string;
  if (spellKind(spell) === 'heal') {
    const members = activeCharacters(party);
    const ti = await host.menu(`Heal whom?`, [...members.map((m) => `${m.name} (${m.skills.health.trueSkill}/${m.skills.health.max})`), 'Cancel']);
    const target = members[ti];
    if (!target) return undefined;
    const r = castHeal(host.getParty(), caster.index, spell, power, target.index);
    host.setParty(r.party);
    message = r.message;
  } else {
    host.setParty(updateCharacter(host.getParty(), caster.index, (c) => payCost(c, power)));
    lights.push({ spell: spell.index, endTicks: host.getTicks() + spellTicks(power) });
    host.onLight?.(currentLight(lights, host.getTicks()));
    message = `${caster.name} casts ${spell.name}. The light will last until ${formatTime(host.getTicks() + spellTicks(power))}.`;
  }
  await host.menu(message, []);
  return message;
}

/** V casts a spell. The only wiring main.ts needs: one call with the host. */
export function installCast(host: CastHost): { lights: readonly ActiveLight[] } {
  const lights: ActiveLight[] = [];
  let busy = false;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyV' || e.repeat || busy || !host.canCast()) return;
    busy = true;
    runCast(host, lights).finally(() => { busy = false; });
  });
  return { lights };
}
