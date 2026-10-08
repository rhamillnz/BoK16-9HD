import type { ItemDef } from '../formats/objinfo';
import { camp, campSummary, countRations, type CampPlan, type CampResult } from './camp';
import { activeCharacters, type PartyState } from './party';
import { formatTime, type WorldState } from './state';

/** What camping needs from the running game. */
export interface CampHost {
  items: readonly ItemDef[];
  getParty(): PartyState;
  setParty(p: PartyState): void;
  getWorld(): WorldState;
  setWorld(w: WorldState): void;
  /** False while a screen, dialogue, town scene, fight or zone change owns the game. */
  canCamp(): boolean;
  /** Show text with choices (or none, for a plain message) and resolve to the picked index, -1 when dismissed. */
  menu(text: string, choices: string[]): Promise<number>;
  /** The clock moved: refresh the sky. */
  onTimePassed(): void;
  /** An ambush cut the rest short. Optional hook for starting a fight. */
  onInterrupted?(): void;
}

const PLANS: { label: string; plan: CampPlan }[] = [
  { label: 'Rest 1 hour', plan: { kind: 'hours', hours: 1 } },
  { label: 'Rest 4 hours', plan: { kind: 'hours', hours: 4 } },
  { label: 'Rest until morning', plan: { kind: 'morning' } },
  { label: 'Rest until healed', plan: { kind: 'healed' } },
];

/** Run one camp: pick a plan, rest, report. Resolves to the result, or undefined when cancelled. */
export async function runCamp(host: CampHost): Promise<CampResult | undefined> {
  const party = host.getParty();
  const world = host.getWorld();
  const rations = countRations(party, host.items);
  const hurt = activeCharacters(party).filter((c) => c.skills.health.trueSkill < c.skills.health.max).length;
  const text = `Make camp?\n${formatTime(world.ticks)}. Rations: ${rations}. ${hurt === 0 ? 'Nobody is hurt.' : `${hurt} hurt.`}`;
  const picked = await host.menu(text, [...PLANS.map((p) => p.label), 'Break camp']);
  const choice = PLANS[picked];
  if (!choice) return undefined;

  const result = camp(world, party, choice.plan, { items: host.items });
  host.setWorld(result.world);
  host.setParty(result.party);
  host.onTimePassed();
  await host.menu(campSummary(result, party, result.party).join('\n'), []);
  if (result.interrupted) host.onInterrupted?.();
  return result;
}

/** R makes camp. The only wiring main.ts needs: one call with the host. */
export function installCamp(host: CampHost): void {
  let busy = false;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyR' || e.repeat || busy || !host.canCamp()) return;
    busy = true;
    runCamp(host).finally(() => {
      busy = false;
    });
  });
}
