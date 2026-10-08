import * as THREE from 'three/webgpu';
import { enemyTurn } from '../combat/ai';
import {
  attack,
  castableSpells,
  castSpell,
  currentFighter,
  defend,
  fighterAt,
  flee,
  isOver,
  moveTo,
  rest,
  shoot,
  shootTargets,
  startBattle,
  type BattleEvent,
  type BattleState,
  type Fighter,
} from '../combat/battle';
import {
  parseCombatTable,
  parsePartyGrid,
  readCombatEnemies,
  type CombatDef,
  type PartyGridSlot,
} from '../combat/combatData';
import { COMBAT_GRID_COLS, COMBAT_GRID_ROWS, type GridPos } from '../combat/grid';
import { parseMonsterNames, parseMonsterSprites, type MonsterSprites } from '../combat/monsters';
import { battleRewards, type Rewards } from '../combat/rewards';
import { rollFrom, type Roll } from '../combat/rules';
import { combatSprite, spriteSheetName, type CombatSprite } from '../combat/sprites';
import type { CombatOutcome } from '../combat/turns';
import { parseBMX, type IndexedImage } from '../formats/bmx';
import type { ResourceArchive } from '../formats/archive';
import { parsePalette, type Palette } from '../formats/palette';
import { parseTBL, type ModelTable } from '../formats/tbl';
import { playBattleSounds } from '../audio/combatSfx';
import { CombatView } from '../render/combatView';
import { CombatPanel } from '../ui/combatPanel';
import { spellKind } from './spells';
import { prefetchResources, type ReadResource } from './encounterDriver';

/** Seconds an enemy takes to "think" between turns, so the player can follow what happens. */
const ENEMY_DELAY = 0.7;

/** Tables a fight needs, read once at start-up. Anything missing leaves combat disabled or sprite-less. */
export interface CombatSupport {
  defs: CombatDef[];
  partyGrid: PartyGridSlot[];
  monsterNames: string[];
  sprites: MonsterSprites[];
  table?: ModelTable;
  palette?: Palette;
  save: Uint8Array;
  archive: ResourceArchive;
}

const SUPPORT_FILES = ['DEF_COMB.DAT', 'P1.DAT', 'MNAMES.DAT', 'BNAMES.DAT', 'COMBAT.TBL', 'Z01.PAL'];

export async function loadCombatSupport(archive: ResourceArchive, save: Uint8Array): Promise<CombatSupport> {
  const read = await prefetchResources(archive, SUPPORT_FILES);
  const parse = <T>(name: string, f: (b: Uint8Array) => T, fallback: T): T => {
    const bytes = read(name);
    if (!bytes) return fallback;
    try {
      return f(bytes);
    } catch (err) {
      console.warn(`combat: cannot read ${name}:`, err);
      return fallback;
    }
  };
  return {
    defs: parse('DEF_COMB.DAT', parseCombatTable, []),
    partyGrid: parse('P1.DAT', parsePartyGrid, []),
    monsterNames: parse('MNAMES.DAT', parseMonsterNames, []),
    sprites: parse('BNAMES.DAT', parseMonsterSprites, []),
    table: parse('COMBAT.TBL', parseTBL, undefined),
    palette: parse('Z01.PAL', parsePalette, undefined),
    save,
    archive,
  };
}

/** Sprite sheets for the monsters of one fight, loaded ahead because the view builds its textures synchronously. */
export async function loadSheets(support: CombatSupport, monsters: readonly number[]): Promise<ReadResource> {
  const names = new Set<string>();
  for (const m of monsters) {
    const set = support.sprites[m];
    if (set && set.prefix !== '') names.add(spriteSheetName(set));
  }
  return prefetchResources(support.archive, [...names]);
}

export function spriteLookup(
  support: CombatSupport,
  sheets: ReadResource,
): (monster: number) => CombatSprite | undefined {
  const cache = new Map<string, IndexedImage[] | undefined>();
  const load = (name: string) => {
    if (!cache.has(name)) {
      const bytes = sheets(name);
      let images: IndexedImage[] | undefined;
      try {
        images = bytes ? parseBMX(bytes) : undefined;
      } catch (err) {
        console.warn(`combat: cannot read ${name}:`, err);
      }
      cache.set(name, images);
    }
    return cache.get(name);
  };
  return (monster) => (support.table ? combatSprite(monster, support.table, support.sprites, load) : undefined);
}

export const enemiesOf = (support: CombatSupport, def: CombatDef) => readCombatEnemies(support.save, def.combatIndex);

export interface CombatHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The WebGPU canvas; clicks on it pick grid cells. */
  canvas: HTMLElement;
  getHeight: (x: number, y: number) => number;
}

export interface CombatLaunch {
  fighters: Fighter[];
  /** The party's position and heading when the fight began. */
  party: { x: number; y: number };
  heading: number;
  spriteFor: (monster: number) => CombatSprite | undefined;
  palette: Uint8Array;
}

/** What the fight produced beyond the outcome: its event history and, after a win, the rewards. */
export interface CombatResult {
  history: readonly BattleEvent[];
  rewards?: Rewards;
}

export type CombatEnd = (outcome: CombatOutcome, fighters: readonly Fighter[], result: CombatResult) => void;

/**
 * Runs one fight: shows the grid and fighters, takes the player's clicks and keys on the party's
 * turns, plays the enemies' turns with a short pause, and reports the outcome when the player
 * confirms the result. The rules live in src/combat; this only wires them to the screen.
 */
export class CombatController {
  private state: BattleState | undefined;
  private view: CombatView | undefined;
  private panel: CombatPanel | undefined;
  private hover: GridPos | undefined;
  private slash = false;
  private shooting = false;
  /** Index into the current fighter's castable spells, or -1 when not casting. */
  private casting = -1;
  private rewards: Rewards | undefined;
  private delay = 0;
  private onEnd: CombatEnd | undefined;
  private readonly roll: Roll = rollFrom(Math.random);
  private readonly listeners: [string, (e: MouseEvent) => void][] = [];

  constructor(private readonly host: CombatHost) {}

  get active(): boolean {
    return this.state !== undefined;
  }

  begin(launch: CombatLaunch, onEnd: CombatEnd): void {
    if (this.active) return;
    this.onEnd = onEnd;
    this.slash = false;
    this.shooting = false;
    this.casting = -1;
    this.rewards = undefined;
    this.state = startBattle(launch.fighters);
    this.view = new CombatView(
      {
        party: launch.party,
        heading: launch.heading,
        cols: COMBAT_GRID_COLS,
        rows: COMBAT_GRID_ROWS,
        getHeight: this.host.getHeight,
        spriteFor: launch.spriteFor,
        palette: launch.palette,
      },
      launch.fighters,
    );
    this.host.scene.add(this.view.group);
    this.panel = new CombatPanel(document.body, {
      defend: () => this.partyAction(defend),
      wait: () => this.partyAction(rest),
      flee: () => this.partyAction(flee),
      toggleSlash: () => {
        this.slash = !this.slash;
        this.shooting = false;
        this.casting = -1;
        this.refresh();
      },
      toggleShoot: () => {
        this.shooting = !this.shooting;
        this.slash = false;
        this.casting = -1;
        this.refresh();
      },
      cycleCast: () => this.cycleCast(),
      finish: () => this.finish(),
    });
    const on = (type: string, f: (e: MouseEvent) => void) => {
      this.host.canvas.addEventListener(type, f as EventListener);
      this.listeners.push([type, f]);
    };
    on('mousemove', (e) => {
      this.hover = this.cellAt(e);
      this.refresh(false);
    });
    on('click', (e) => this.click(this.cellAt(e), e.shiftKey));
    this.refresh();
    this.delay = ENEMY_DELAY;
  }

  /** Per frame: play the enemies' turns. */
  update(dt: number): void {
    const s = this.state;
    if (!s || isOver(s) || currentFighter(s).side === 'party') return;
    this.delay -= dt;
    if (this.delay > 0) return;
    this.delay = ENEMY_DELAY;
    this.state = enemyTurn(s, this.roll);
    this.refresh();
  }

  applyCamera(): void {
    this.view?.applyCamera(this.host.camera);
  }

  private yourTurn(): boolean {
    const s = this.state;
    return !!s && !isOver(s) && currentFighter(s).side === 'party';
  }

  private cellAt(e: MouseEvent): GridPos | undefined {
    const r = this.host.canvas.getBoundingClientRect();
    return this.view?.pick(
      this.host.camera,
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -(((e.clientY - r.top) / r.height) * 2 - 1),
    );
  }

  private refresh(withLog = true): void {
    const s = this.state;
    if (!s || !this.view || !this.panel) return;
    this.view.update(s, this.yourTurn() ? this.hover : undefined);
    if (withLog)
      this.panel.render(s, {
        slash: this.slash,
        shoot: this.shooting,
        canShoot: this.canShoot(),
        cast: this.castName(),
        canCast: this.canCast(),
        yourTurn: this.yourTurn(),
      });
    if (withLog && isOver(s) && !this.rewards && s.turn.outcome === 'won') {
      this.rewards = battleRewards(s.fighters, s.history, this.roll);
      for (const line of this.rewards.lines) this.panel.note(line);
    }
    if (withLog) {
      playBattleSounds(s.events, s.fighters);
      s.events = [];
    }
  }

  private canShoot(): boolean {
    const s = this.state;
    return !!s && this.yourTurn() && shootTargets(s).length > 0;
  }

  private spellsNow() {
    const s = this.state;
    return s && this.yourTurn() ? castableSpells(s) : [];
  }

  private castName(): string | undefined {
    return this.spellsNow()[this.casting]?.name;
  }

  private canCast(): boolean {
    return this.spellsNow().length > 0;
  }

  private cycleCast(): void {
    const n = this.spellsNow().length;
    if (n === 0) {
      this.panel?.note('Nobody here can cast a spell right now.');
      return;
    }
    this.casting = this.casting + 1 >= n ? -1 : this.casting + 1;
    this.slash = false;
    this.shooting = false;
    this.refresh();
  }

  private partyAction(f: (s: BattleState) => BattleState | undefined): void {
    if (!this.state || !this.yourTurn()) return;
    const next = f(this.state);
    if (!next) return;
    this.state = next;
    this.casting = -1;
    this.delay = ENEMY_DELAY;
    this.refresh();
  }

  private click(cell: GridPos | undefined, shift: boolean): void {
    const s = this.state;
    if (!s || !cell || !this.yourTurn()) return;
    const target = fighterAt(s, cell);
    const spell = this.spellsNow()[this.casting];
    if (spell && target) {
      const next = castSpell(s, spell.index, cell);
      if (next) {
        this.casting = -1;
        this.partyAction(() => next);
      } else
        this.panel?.note(
          `${spell.name} needs ${spellKind(spell) === 'heal' ? 'a living ally' : 'an enemy'} within range.`,
        );
    } else if (target && target.side === 'enemy' && this.shooting) {
      const next = shoot(s, cell, this.roll);
      if (next) this.partyAction(() => next);
      else this.panel?.note('You cannot shoot that: it needs an equipped crossbow and a target within range.');
    } else if (target && target.side === 'enemy') {
      const next = attack(s, cell, this.roll, { kind: this.slash || shift ? 'slash' : 'thrust' });
      if (next) this.partyAction(() => next);
      else
        this.panel?.note(
          this.slash || shift ? 'A slash needs an adjacent enemy and more than 1 stamina.' : 'Out of reach.',
        );
    } else if (!target) {
      const next = moveTo(s, cell);
      if (next) this.partyAction(() => next);
      else this.panel?.note('Too far to walk this turn.');
    }
  }

  private finish(): void {
    const s = this.state;
    if (!s || !isOver(s)) return;
    const outcome = s.turn.outcome!;
    const fighters = s.fighters;
    const result: CombatResult = { history: s.history, rewards: this.rewards };
    this.close();
    this.onEnd?.(outcome, fighters, result);
  }

  private close(): void {
    for (const [type, f] of this.listeners) this.host.canvas.removeEventListener(type, f as EventListener);
    this.listeners.length = 0;
    this.panel?.dispose();
    this.view?.dispose();
    this.panel = undefined;
    this.view = undefined;
    this.state = undefined;
  }
}
