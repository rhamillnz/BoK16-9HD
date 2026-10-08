import type * as THREE from 'three/webgpu';
import { applyCombatPractice, applyRewards, applyWear } from '../combat/rewards';
import { rollFrom } from '../combat/rules';
import { buildFighters, applyBattleToParty, retreatDestination } from '../combat/setup';
import type { Fighter } from '../combat/battle';
import type { CombatOutcome } from '../combat/turns';
import type { SpellDef } from '../formats/spells';
import type { ItemDef } from '../formats/objinfo';
import type { PlacedEncounter } from '../world/encounters';
import { activeCharacters, updateCharacter, type PartyState } from './party';
import {
  CombatController,
  enemiesOf,
  loadSheets,
  spriteLookup,
  type CombatResult,
  type CombatSupport,
} from './combatController';

export interface CombatEncounterDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  getHeight: (x: number, y: number) => number;
  support: CombatSupport;
  items: readonly ItemDef[];
  /** SPELLS.DAT, so magic-users can cast. */
  spells?: readonly SpellDef[];
  /** The party's current position and 8-bit heading. */
  position: () => { x: number; y: number; heading: number };
  /** Move the party (after a retreat) without firing the encounters it lands in. */
  placeParty: (x: number, y: number, heading: number) => void;
  getParty: () => PartyState;
  setParty: (p: PartyState) => void;
  /** Record the encounter as done (its completion flag and "seen" state). */
  markDone: (e: PlacedEncounter) => void;
}

/** A party member who fell is back on their feet with 1 Health when the party is beaten and retreats. */
function revive(party: PartyState): PartyState {
  let next = party;
  for (const c of party.characters) {
    if (c.skills.health.trueSkill > 0) continue;
    next = updateCharacter(next, c.index, (ch) => ({
      ...ch,
      skills: { ...ch.skills, health: { ...ch.skills.health, trueSkill: 1 } },
    }));
  }
  return next;
}

/**
 * Glue between the encounter system and a fight: builds the fighters for a combat encounter, runs it,
 * and applies the result (wounds, the encounter marked done on a win, the retreat move otherwise).
 * Entry and scout dialogues and the post-fight dialogue are not handled yet.
 */
export class CombatEncounters {
  private readonly controller: CombatController;
  private starting = false;

  constructor(private readonly d: CombatEncounterDeps) {
    this.controller = new CombatController({
      scene: d.scene,
      camera: d.camera,
      canvas: d.canvas,
      getHeight: d.getHeight,
    });
  }

  /** True from the moment a fight is requested until its result is applied. */
  get active(): boolean {
    return this.starting || this.controller.active;
  }

  update(dt: number): void {
    this.controller.update(dt);
  }

  applyCamera(): void {
    this.controller.applyCamera();
  }

  /** Start the fight for a combat encounter; resolves once it is on screen (or was skipped). */
  async start(e: PlacedEncounter): Promise<void> {
    if (this.active) return;
    const { support: s, items } = this.d;
    const def = s.defs[e.record.tableIndex];
    if (!def) {
      console.warn('combat: no combat table entry', e.record.tableIndex);
      return;
    }
    this.starting = true;
    try {
      const enemies = enemiesOf(s, def);
      const fighters = buildFighters({
        def,
        enemies,
        party: activeCharacters(this.d.getParty()),
        partyGrid: s.partyGrid,
        monsterNames: s.monsterNames,
        items,
        spells: this.d.spells,
      });
      const sheets = await loadSheets(
        s,
        fighters.map((f) => f.monster),
      );
      const pos = this.d.position();
      this.controller.begin(
        {
          fighters,
          party: pos,
          heading: pos.heading,
          spriteFor: spriteLookup(s, sheets),
          palette: s.palette ?? new Uint8Array(1024).fill(255),
        },
        (outcome, after, result) => this.finished(e, def, outcome, after, pos, result),
      );
    } finally {
      this.starting = false;
    }
  }

  private finished(
    e: PlacedEncounter,
    def: NonNullable<CombatSupport['defs'][number]>,
    outcome: CombatOutcome,
    fighters: readonly Fighter[],
    at: { x: number; y: number },
    result: CombatResult,
  ): void {
    let party = applyBattleToParty(this.d.getParty(), fighters);
    party = applyWear(party, result.history, this.d.items, rollFrom(Math.random));
    party = applyCombatPractice(party, result.history);
    if (outcome === 'won') {
      if (result.rewards) party = applyRewards(party, result.rewards);
      this.d.markDone(e);
    } else {
      if (outcome === 'dead') party = revive(party);
      const centre = { x: (e.minX + e.maxX) / 2, y: (e.minY + e.maxY) / 2 };
      const to = retreatDestination(def, { x: e.tileX, y: e.tileY }, at, centre);
      this.d.placeParty(to.x, to.y, to.heading);
    }
    this.d.setParty(party);
  }
}
