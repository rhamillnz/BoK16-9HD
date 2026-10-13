import type * as THREE from 'three/webgpu';
import { applyCombatPractice, applyRewards, applyWear } from '../combat/rewards';
import { rollFrom } from '../combat/rules';
import { fitCombatGrid } from '../combat/gridFit';
import { combatClearArea } from '../combat/layout';
import { COMBAT_GRID_COLS, COMBAT_GRID_ROWS } from '../combat/grid';
import { buildFighters, applyBattleToParty, retreatDestination } from '../combat/setup';
import type { Fighter } from '../combat/battle';
import type { CombatOutcome } from '../combat/turns';
import type { SpellDef } from '../formats/spells';
import type { ItemDef } from '../formats/objinfo';
import type { PlacedEncounter } from '../world/encounters';
import type { ContainerItem } from '../formats/containers';
import { lootOf } from '../combat/loot';
import { activeCharacters, updateCharacter, type PartyState } from './party';
import { approachCombat } from './combatApproach';
import { NEVER_ENDING_COMBATS } from './postCombat';
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
  /** True inside a hill or other solid model; combat cells there are disabled. */
  blocked?: (x: number, y: number) => boolean;
  /**
   * Height of what is drawn there (the ground, or a hill model standing on it). The grid, the fighters and the
   * camera stand on this, and the grid is placed where the camera can see it.
   */
  surface?: (x: number, y: number) => number;
  /**
   * Hide the world's trees, props and bodies standing in `area` (BaK units) while a fight is on, so none hides the
   * grid; returns the function that shows them again.
   */
  hideProps?: (area: (x: number, y: number) => boolean) => () => void;
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
  /** Game time in ticks (when an ambush was scouted). */
  now?: () => number;
  /** Uniform 0..99 for the scouting and stealth rolls. */
  roll?: () => number;
  /**
   * Play a combat's scouting or entry dialogue with the approach context (0x7530) and the monster for its text;
   * resolves when it ends. Without it the fight starts at once.
   */
  playDialog?: (key: number, text: { context: number; monster?: string }) => Promise<void>;
  /** After a win (and the encounter marked done): flags particular fights set (postCombat.ts). */
  afterWin?: (combatIndex: number) => void;
  /** After a win: let the party search what the slain carried. */
  searchBodies?: (items: readonly ContainerItem[]) => Promise<void>;
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
 * Before the fight: scouting, slipping past and the entry dialogue (combatApproach.ts).
 */
export class CombatEncounters {
  private readonly controller: CombatController;
  private starting = false;
  /** Ambushes already tried for scouting (by encounter), and when each combat was scouted. */
  private readonly scoutTried = new Set<string>();
  private readonly scoutedAt = new Map<number, number>();

  constructor(private readonly d: CombatEncounterDeps) {
    this.controller = new CombatController({
      scene: d.scene,
      camera: d.camera,
      canvas: d.canvas,
      getHeight: d.surface ?? d.getHeight,
    });
  }

  private approaching = false;

  /** True from the moment a fight is requested until its result is applied (including its entry dialogue). */
  get active(): boolean {
    return this.starting || this.approaching || this.controller.active;
  }

  update(dt: number): void {
    this.controller.update(dt);
  }

  applyCamera(): void {
    this.controller.applyCamera();
  }

  /**
   * The party walked into a combat encounter: an ambush may be scouted (its text, no fight yet) or the party may
   * slip past (combatApproach.ts); otherwise the entry dialogue plays and the fight starts. Resolves once the fight
   * is on screen (or did not happen).
   */
  async start(e: PlacedEncounter): Promise<void> {
    const def = this.d.support.defs[e.record.tableIndex];
    if (!def) {
      console.warn('combat: no combat table entry', e.record.tableIndex);
      return;
    }
    if (this.active || this.approaching) return;
    this.approaching = true;
    try {
      const key = `${e.tileX},${e.tileY}:${e.record.tableIndex}`;
      const now = this.d.now?.() ?? 0;
      const a = approachCombat({
        party: this.d.getParty(),
        def,
        scoutTried: this.scoutTried.has(key),
        scoutedAt: this.scoutedAt.get(def.combatIndex),
        now,
        roll: this.d.roll ?? (() => Math.floor(Math.random() * 100)),
      });
      if (def.ambush) this.scoutTried.add(key);
      this.d.setParty(a.party);
      if (a.kind === 'avoided') return;
      const last = def.combatants[def.combatants.length - 1];
      const monster = last ? this.d.support.monsterNames[last.monster] : undefined;
      if (a.kind === 'scouted') {
        this.scoutedAt.set(def.combatIndex, now);
        await this.d.playDialog?.(a.dialog, { context: 0, monster });
        return;
      }
      if (def.entryDialog !== 0) await this.d.playDialog?.(def.entryDialog, { context: a.context, monster });
    } finally {
      this.approaching = false;
    }
    await this.launch(def, false, (outcome, fighters, at, result) =>
      this.finished(e, def, outcome, fighters, at, result),
    );
  }

  /**
   * A fight the remake adds (a chest ambush): the monsters of DEF_COMB entry `defIndex`, fresh, around the party.
   * Resolves with the outcome once the result is applied: a win or a loss; on a loss the party, revived, steps back
   * the way it came. Undefined when the fight could not start.
   */
  ambush(defIndex: number): Promise<CombatOutcome | undefined> {
    const def = this.d.support.defs[defIndex];
    if (!def || this.active) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      void this.launch(def, true, (outcome, fighters, at, result) => {
        let party = this.settle(outcome, fighters, result);
        if (outcome === 'won') {
          this.d.setParty(party);
          const loot = lootOf(this.d.support.inventories, def.combatIndex, fighters);
          void (this.d.searchBodies?.(loot) ?? Promise.resolve()).then(() => resolve(outcome));
          return;
        }
        if (outcome === 'dead') party = revive(party);
        const back = ((this.d.position().heading + 128) & 255) * ((Math.PI * 2) / 256);
        // Heading 0 is north (+y), counter-clockwise: a step of 1200 units back along the way the party came.
        this.d.placeParty(at.x - Math.sin(back) * 1200, at.y + Math.cos(back) * 1200, this.d.position().heading);
        this.d.setParty(party);
        resolve(outcome);
      }).then((started) => {
        if (!started) resolve(undefined);
      });
    });
  }

  /** Build and start a fight; resolves true once it is on screen. `fresh` revives the save's monster records. */
  private async launch(
    def: NonNullable<CombatSupport['defs'][number]>,
    fresh: boolean,
    done: (
      outcome: CombatOutcome,
      fighters: readonly Fighter[],
      at: { x: number; y: number },
      result: CombatResult,
    ) => void,
  ): Promise<boolean> {
    if (this.active) return false;
    const { support: s, items } = this.d;
    this.starting = true;
    let restore: (() => void) | undefined;
    try {
      const enemies = enemiesOf(s, def).map((e) => (fresh ? { ...e, dead: false } : e));
      const pos = this.d.position();
      // Slide or turn the grid off any rock face or hill the party is facing, to where the camera can see it;
      // cells that stay on one are disabled.
      const fit = fitCombatGrid(pos, pos.heading, COMBAT_GRID_COLS, COMBAT_GRID_ROWS, this.d.getHeight, {
        blocked: this.d.blocked,
        surface: this.d.surface,
      });
      const show = this.d.hideProps?.(combatClearArea(fit.anchor, fit.heading, COMBAT_GRID_COLS, COMBAT_GRID_ROWS));
      restore = show;
      const fighters = buildFighters({
        disabled: fit.disabled,
        def,
        enemies,
        party: activeCharacters(this.d.getParty()),
        partyGrid: s.partyGrid,
        monsterNames: s.monsterNames,
        items,
        spells: this.d.spells,
        inventories: s.inventories,
      });
      const sheets = await loadSheets(
        s,
        fighters.map((f) => f.monster),
      );
      this.controller.begin(
        {
          fighters,
          party: fit.anchor,
          disabled: fit.disabled,
          heading: fit.heading,
          spriteFor: spriteLookup(s, sheets),
          palette: s.palette ?? new Uint8Array(1024).fill(255),
        },
        (outcome, after, result) => {
          show?.();
          done(outcome, after, pos, result);
        },
      );
      restore = undefined;
      return true;
    } catch (err) {
      restore?.();
      throw err;
    } finally {
      this.starting = false;
    }
  }

  /** Wounds, wear, practice and (after a win) rewards from a finished fight. */
  private settle(outcome: CombatOutcome, fighters: readonly Fighter[], result: CombatResult): PartyState {
    let party = applyBattleToParty(this.d.getParty(), fighters);
    party = applyWear(party, result.history, this.d.items, rollFrom(Math.random));
    party = applyCombatPractice(party, result.history);
    if (outcome === 'won' && result.rewards) party = applyRewards(party, result.rewards);
    return party;
  }

  private finished(
    e: PlacedEncounter,
    def: NonNullable<CombatSupport['defs'][number]>,
    outcome: CombatOutcome,
    fighters: readonly Fighter[],
    at: { x: number; y: number },
    result: CombatResult,
  ): void {
    let party = this.settle(outcome, fighters, result);
    if (outcome === 'won') {
      // A few story fights never stay won (BaKGL reactivates them).
      if (!NEVER_ENDING_COMBATS.has(def.combatIndex)) this.d.markDone(e);
      this.d.afterWin?.(def.combatIndex);
      this.d.setParty(party);
      void this.d.searchBodies?.(lootOf(this.d.support.inventories, def.combatIndex, fighters));
      return;
    } else {
      if (outcome === 'dead') party = revive(party);
      const centre = { x: (e.minX + e.maxX) / 2, y: (e.minY + e.maxY) / 2 };
      const to = retreatDestination(def, { x: e.tileX, y: e.tileY }, at, centre);
      this.d.placeParty(to.x, to.y, to.heading);
    }
    this.d.setParty(party);
  }
}
