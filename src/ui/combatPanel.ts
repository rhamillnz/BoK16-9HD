import { currentFighter, describeEvent, isOver, type BattleState, type Fighter } from '../combat/battle';
import { isDead } from '../combat/rules';

/** One line of the fighter list: name, health and stamina, and whose turn it is. */
export interface FighterRow {
  name: string;
  side: 'party' | 'enemy';
  health: string;
  stamina: string;
  /// Share of health left, 0..1, for the bar.
  fraction: number;
  dead: boolean;
  current: boolean;
  defending: boolean;
}

export function fighterRows(state: BattleState): FighterRow[] {
  const me = isOver(state) ? undefined : currentFighter(state);
  return state.fighters.map((f: Fighter) => ({
    name: f.name,
    side: f.side,
    health: `${f.health}/${f.maxHealth}`,
    stamina: `${f.stamina}/${f.maxStamina}`,
    fraction: f.maxHealth > 0 ? Math.max(0, Math.min(1, f.health / f.maxHealth)) : 0,
    dead: isDead(f),
    current: me === f,
    defending: f.defending === true,
  }));
}

/** Log lines for the events of one action. */
export function logLines(state: BattleState): string[] {
  return state.events.map((e) => describeEvent(state, e));
}

export const OUTCOME_TEXT = {
  won: 'Victory! Press Enter to continue.',
  fled: 'The party retreats. Press Enter to continue.',
  dead: 'The party has fallen. Press Enter to continue.',
} as const;

export interface CombatPanelHandlers {
  defend(): void;
  wait(): void;
  flee(): void;
  toggleSlash(): void;
  toggleShoot(): void;
  /** Cycle through the caster's spells, then off. */
  cycleCast(): void;
  finish(): void;
}

/** DOM overlay for a fight: fighter list, buttons and a short log. Keyboard: D defend, W wait, Q retreat, S slash, F shoot, C cast, Enter continue. */
export class CombatPanel {
  private readonly root = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly buttons = document.createElement('div');
  private readonly log = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly targets = document.createElement('div');
  private targetActions: (() => void)[] = [];
  private readonly slashButton: HTMLButtonElement;
  private readonly shootButton: HTMLButtonElement;
  private readonly castButton: HTMLButtonElement;
  private readonly lines: string[] = [];
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(parent: HTMLElement, h: CombatPanelHandlers) {
    this.root.style.cssText =
      'position:fixed;right:12px;top:12px;width:300px;font:14px/1.35 sans-serif;color:#f2ead8;background:rgba(18,14,10,.82);border:2px solid #7a5c2e;border-radius:6px;padding:10px;z-index:20;user-select:none';
    this.buttons.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:8px 0';
    this.log.style.cssText = 'min-height:7.5em;font-size:13px;opacity:.95';
    this.status.style.cssText = 'font-weight:bold;margin-bottom:4px';
    const button = (label: string, on: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText =
        'flex:1;padding:4px 6px;background:#3a2c18;color:#f2ead8;border:1px solid #7a5c2e;border-radius:4px;cursor:pointer';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        on();
      });
      this.buttons.append(b);
      return b;
    };
    button('Defend (D)', h.defend);
    button('Wait (W)', h.wait);
    button('Retreat (Q)', h.flee);
    this.slashButton = button('Slash: off (S)', h.toggleSlash);
    this.shootButton = button('Shoot: off (F)', h.toggleShoot);
    this.castButton = button('Cast: off (C)', h.cycleCast);
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;opacity:.7;margin-bottom:6px';
    hint.textContent =
      'Pick a target below (or press its number), or click a blue cell to move and a red one to attack.';
    this.targets.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:0 0 8px';
    this.root.append(this.status, this.list, this.buttons, this.targets, hint, this.log);
    parent.append(this.root);
    this.onKey = (e) => {
      if (e.repeat) return;
      const k = e.code;
      if (k === 'KeyD') h.defend();
      else if (k === 'KeyW') h.wait();
      else if (k === 'KeyQ') h.flee();
      else if (k === 'KeyS') h.toggleSlash();
      else if (k === 'KeyF') h.toggleShoot();
      else if (k === 'KeyC') h.cycleCast();
      else if (k === 'Enter' || k === 'Space') h.finish();
      else if (/^(Digit|Numpad)[1-9]$/.test(k)) this.targetActions[Number(k.slice(-1)) - 1]?.();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', this.onKey, true);
  }

  render(
    state: BattleState,
    opts: { slash: boolean; shoot?: boolean; canShoot?: boolean; cast?: string; canCast?: boolean; yourTurn: boolean },
  ): void {
    this.lines.push(...logLines(state));
    while (this.lines.length > 9) this.lines.shift();
    const rows = fighterRows(state);
    this.list.replaceChildren(
      ...rows.map((r) => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;justify-content:space-between;opacity:${r.dead ? 0.4 : 1};color:${r.side === 'party' ? '#9cc4ff' : '#ff9a90'};${r.current ? 'font-weight:bold;text-decoration:underline;' : ''}`;
        row.textContent = `${r.name}${r.defending ? ' (def)' : ''}`;
        const stats = document.createElement('span');
        stats.textContent = r.dead ? 'down' : `${r.health} HP  ${r.stamina} St`;
        row.append(stats);
        return row;
      }),
    );
    this.log.replaceChildren(
      ...this.lines.map((l) => Object.assign(document.createElement('div'), { textContent: l })),
    );
    const outcome = state.turn.outcome;
    this.status.textContent = outcome
      ? OUTCOME_TEXT[outcome]
      : opts.yourTurn
        ? `${currentFighter(state).name}: your move`
        : 'Enemy turn…';
    this.slashButton.textContent = `Slash: ${opts.slash ? 'on' : 'off'} (S)`;
    this.shootButton.textContent = `Shoot: ${opts.shoot ? 'on' : 'off'} (F)`;
    this.castButton.textContent = `Cast: ${opts.cast ?? 'off'} (C)`;
    this.castButton.style.opacity = opts.canCast ? '1' : '0.4';
    this.shootButton.style.opacity = opts.canShoot ? '1' : '0.4';
    this.buttons.style.opacity = opts.yourTurn && !outcome ? '1' : '0.5';
  }

  /**
   * One button per target the current fighter can act on ("Attack moredhel warrior", "Advance on ...", a spell's
   * target), numbered for the keys 1 to 9. An empty list hides them (not your turn, or the fight is over).
   */
  setTargets(list: readonly { label: string; act: () => void }[]): void {
    this.targetActions = list.slice(0, 9).map((t) => t.act);
    this.targets.replaceChildren(
      ...list.slice(0, 9).map((t, i) => {
        const b = document.createElement('button');
        b.textContent = `${i + 1}. ${t.label}`;
        b.style.cssText =
          'text-align:left;padding:5px 8px;background:#5a2418;color:#fff0e0;border:1px solid #b0503a;border-radius:4px;cursor:pointer;font:inherit';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          t.act();
        });
        return b;
      }),
    );
  }

  /** A line that is not a battle event (a refused click, say). */
  note(text: string): void {
    this.lines.push(text);
    while (this.lines.length > 9) this.lines.shift();
    this.log.replaceChildren(
      ...this.lines.map((l) => Object.assign(document.createElement('div'), { textContent: l })),
    );
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
  }
}
