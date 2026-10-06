import { CONDITION_NAMES, SKILL_NAMES, effectiveSkill, type Character, type ConditionName, type GamSave, type SkillName } from '../formats/gam';
import { glyphFor, measureString, type Font } from '../formats/fnt';
import { HUD_HEIGHT, HUD_WIDTH, type Rect } from './dialogBox';

/** Display names for the 16 skills, in `SKILL_NAMES` order. */
export const SKILL_LABELS: Record<SkillName, string> = {
  health: 'Health', stamina: 'Stamina', speed: 'Speed', strength: 'Strength', defense: 'Defense',
  crossbow: 'Crossbow', melee: 'Melee', casting: 'Casting', assessment: 'Assessment',
  armorcraft: 'Armorcraft', weaponcraft: 'Weaponcraft', barding: 'Barding', haggling: 'Haggling',
  lockpick: 'Lockpick', scouting: 'Scouting', stealth: 'Stealth',
};

export const CONDITION_LABELS: Record<ConditionName, string> = {
  sick: 'Sick', plagued: 'Plagued', poisoned: 'Poisoned', drunk: 'Drunk',
  healing: 'Healing', starving: 'Starving', nearDeath: 'Near Death',
};

/** Skills shown as the vitals bars, the core attributes, and the learned skills. */
export const VITAL_SKILLS: SkillName[] = ['health', 'stamina'];
export const ATTRIBUTE_SKILLS: SkillName[] = ['speed', 'strength', 'defense'];
export const LEARNED_SKILLS: SkillName[] = SKILL_NAMES.slice(5);

export interface SheetRow {
  skill: SkillName;
  label: string;
  current: number;
  max: number;
  /** Signed modifier applied to the skill (affectors, equipment). */
  modifier: number;
  selected: boolean;
  unseenImprovement: boolean;
  /** current / max in 0..1 (0 when max is 0). */
  fraction: number;
}

export interface SheetCondition {
  name: ConditionName;
  label: string;
  /** 1..100. */
  value: number;
}

/** Everything the sheet displays about one character, with no layout. */
export interface SheetModel {
  name: string;
  index: number;
  vitals: SheetRow[];
  attributes: SheetRow[];
  skills: SheetRow[];
  /** Only non-zero conditions, in `CONDITION_NAMES` order. */
  conditions: SheetCondition[];
  spellCount: number;
}

function row(character: Character, skill: SkillName): SheetRow {
  const s = character.skills[skill];
  // The save's `current` byte is only a cache (0 in STARTUP.GAM); the game shows the recomputed value.
  const current = effectiveSkill(character, skill);
  return {
    skill,
    label: SKILL_LABELS[skill],
    current,
    max: s.max,
    modifier: s.modifier,
    selected: s.selected,
    unseenImprovement: s.unseenImprovement,
    fraction: s.max > 0 ? Math.min(1, current / s.max) : 0,
  };
}

export function buildSheetModel(character: Character): SheetModel {
  const conditions: SheetCondition[] = [];
  for (const name of CONDITION_NAMES) {
    const value = character.conditions[name];
    if (value > 0) conditions.push({ name, label: CONDITION_LABELS[name], value });
  }
  return {
    name: character.name,
    index: character.index,
    vitals: VITAL_SKILLS.map((s) => row(character, s)),
    attributes: ATTRIBUTE_SKILLS.map((s) => row(character, s)),
    skills: LEARNED_SKILLS.map((s) => row(character, s)),
    conditions,
    spellCount: character.spells.length,
  };
}

/** Characters of the active party in party order (indices outside the save are skipped). */
export function partyCharacters(save: Pick<GamSave, 'characters' | 'activeCharacters'>): Character[] {
  const out: Character[] = [];
  for (const i of save.activeCharacters) {
    const c = save.characters[i];
    if (c) out.push(c);
  }
  return out;
}

/** "current/max" with the modifier appended when non-zero, e.g. "45/60 (+5)". */
export function formatSkillValue(r: Pick<SheetRow, 'current' | 'max' | 'modifier'>): string {
  const base = `${r.current}/${r.max}`;
  if (r.modifier === 0) return base;
  return `${base} (${r.modifier > 0 ? '+' : ''}${r.modifier})`;
}

export interface SheetOptions {
  /** Integer pixel-font scale (>= 1). */
  scale: number;
  canvasWidth?: number;
  canvasHeight?: number;
  spacing?: number;
}

export function defaultSheetOptions(canvasWidth = HUD_WIDTH, canvasHeight = HUD_HEIGHT): SheetOptions {
  return { scale: Math.max(1, Math.floor(canvasHeight / 360)), canvasWidth, canvasHeight };
}

export interface TabSlot {
  /** Position in the active party. */
  index: number;
  label: string;
  rect: Rect;
}

export interface RowSlot {
  row: SheetRow;
  /** Whole row (hit area). */
  rect: Rect;
  label: Rect;
  value: Rect;
  /** Bar track; the filled part is `bar.width * row.fraction`. */
  bar: Rect;
}

export interface ConditionSlot {
  condition: SheetCondition;
  rect: Rect;
}

export interface SheetLayout {
  panel: Rect;
  scale: number;
  rowHeight: number;
  tabs: TabSlot[];
  title: Rect;
  vitals: RowSlot[];
  attributes: RowSlot[];
  skills: RowSlot[];
  conditionsHeader: Rect;
  conditions: ConditionSlot[];
}

/**
 * Lay the sheet out in a centred 16:9-friendly panel: a tab strip of party members on top, the name
 * and vitals bars under it, attributes and conditions in a left column, learned skills on the right.
 */
export function layoutCharacterSheet(
  font: Font,
  model: SheetModel,
  tabLabels: string[],
  opts: SheetOptions,
): SheetLayout {
  const { scale } = opts;
  const cw = opts.canvasWidth ?? HUD_WIDTH;
  const ch = opts.canvasHeight ?? HUD_HEIGHT;
  const spacing = opts.spacing ?? 0;
  const rowHeight = (font.height + 3) * scale;
  const pad = 8 * scale;

  const width = Math.floor(cw * 0.7);
  const height = Math.floor(ch * 0.8);
  const panel: Rect = { x: Math.floor((cw - width) / 2), y: Math.floor((ch - height) / 2), width, height };
  const inner: Rect = { x: panel.x + pad, y: panel.y + pad, width: width - 2 * pad, height: height - 2 * pad };

  // Tabs: equal widths across the strip, capped so one tab is not absurdly wide.
  const tabH = rowHeight + 2 * scale;
  const tabW = tabLabels.length === 0 ? 0 : Math.min(Math.floor(inner.width / tabLabels.length), 48 * scale * 4);
  const tabs: TabSlot[] = tabLabels.map((label, index) => ({
    index,
    label,
    rect: { x: inner.x + index * tabW, y: inner.y, width: tabW, height: tabH },
  }));

  const title: Rect = { x: inner.x, y: inner.y + tabH + pad, width: inner.width, height: rowHeight };
  let y = title.y + rowHeight + pad;

  const colGap = 4 * pad;
  const leftW = Math.floor((inner.width - colGap) / 2);
  const left: Rect = { x: inner.x, y, width: leftW, height: 0 };
  const right: Rect = { x: inner.x + leftW + colGap, y, width: inner.width - leftW - colGap, height: 0 };

  // Fixed label column wide enough for the longest skill name.
  const labelW = Math.max(...SKILL_NAMES.map((s) => measureString(font, SKILL_LABELS[s], spacing))) * scale + pad;
  const valueW = measureString(font, '000/000 (+00)', spacing) * scale;
  const makeRow = (r: SheetRow, col: Rect, top: number): RowSlot => {
    const barX = col.x + labelW;
    const barW = Math.max(0, col.width - labelW - valueW - pad);
    return {
      row: r,
      rect: { x: col.x, y: top, width: col.width, height: rowHeight },
      label: { x: col.x, y: top, width: labelW, height: rowHeight },
      value: { x: col.x + col.width - valueW, y: top, width: valueW, height: rowHeight },
      bar: { x: barX, y: top + 2 * scale, width: barW, height: rowHeight - 4 * scale },
    };
  };
  const stack = (rows: SheetRow[], col: Rect, top: number): RowSlot[] => rows.map((r, i) => makeRow(r, col, top + i * rowHeight));

  const vitals = stack(model.vitals, left, y);
  y += model.vitals.length * rowHeight + pad;
  const attributes = stack(model.attributes, left, y);
  y += model.attributes.length * rowHeight + pad;
  const conditionsHeader: Rect = { x: left.x, y, width: left.width, height: rowHeight };
  y += rowHeight;
  const conditions: ConditionSlot[] = model.conditions.map((condition, i) => ({
    condition,
    rect: { x: left.x, y: y + i * rowHeight, width: left.width, height: rowHeight },
  }));
  const skills = stack(model.skills, right, right.y);

  return { panel, scale, rowHeight, tabs, title, vitals, attributes, skills, conditionsHeader, conditions };
}

export type SheetEvent =
  | { type: 'key'; key: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'hover'; x: number; y: number };

export interface SheetState {
  /** Selected tab (index into the active party). */
  tab: number;
}

export type SheetResult = { kind: 'none' } | { kind: 'select'; tab: number } | { kind: 'close' };

export function tabAt(layout: SheetLayout, x: number, y: number): number {
  const hit = layout.tabs.find(({ rect: r }) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  return hit ? hit.index : -1;
}

/**
 * Pure input reducer. Left/Right (or A/D) and Tab cycle characters, digits 1-6 pick one directly,
 * clicks on a tab select it, Escape/C closes the sheet. Hover does nothing (no selectable rows).
 */
export function stepSheet(
  layout: SheetLayout,
  state: SheetState,
  ev: SheetEvent,
): { state: SheetState; result: SheetResult } {
  const n = layout.tabs.length;
  const none: SheetResult = { kind: 'none' };
  const go = (tab: number) => ({ state: { tab }, result: tab === state.tab ? none : ({ kind: 'select', tab } as SheetResult) });
  if (ev.type === 'hover') return { state, result: none };
  if (ev.type === 'click') {
    const i = tabAt(layout, ev.x, ev.y);
    return i >= 0 ? go(i) : { state, result: none };
  }
  if (n === 0) return { state, result: ev.key === 'Escape' ? { kind: 'close' } : none };
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  if (key === 'Escape' || key === 'c') return { state, result: { kind: 'close' } };
  if (key === 'ArrowLeft' || key === 'a') return go((state.tab + n - 1) % n);
  if (key === 'ArrowRight' || key === 'd' || key === 'Tab') return go((state.tab + 1) % n);
  if (/^[1-9]$/.test(key) && Number(key) <= n) return go(Number(key) - 1);
  return { state, result: none };
}

export interface SheetColors {
  background: string;
  border: string;
  text: string;
  dim: string;
  tab: string;
  tabSelected: string;
  barTrack: string;
  barFill: string;
  barLow: string;
  bonus: string;
  penalty: string;
  condition: string;
}

export const DEFAULT_SHEET_COLORS: SheetColors = {
  background: 'rgba(24, 16, 8, 0.94)',
  border: '#c8a050',
  text: '#f0e0b8',
  dim: '#a08c60',
  tab: '#382818',
  tabSelected: '#6a4a20',
  barTrack: '#2a1c0c',
  barFill: '#5a9a3a',
  barLow: '#b84a2a',
  bonus: '#7ad06a',
  penalty: '#e07050',
  condition: '#e0a040',
};

function drawText(ctx: CanvasRenderingContext2D, font: Font, text: string, x: number, y: number, scale: number, css: string, spacing: number): void {
  if (text === '') return;
  ctx.fillStyle = css;
  let gx = x;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(font, text.charCodeAt(i));
    for (let py = 0; py < g.height; py++) {
      for (let px = 0; px < g.width; px++) {
        if (g.pixels[py * g.width + px] !== 0) ctx.fillRect(gx + px * scale, y + py * scale, scale, scale);
      }
    }
    gx += (g.width + spacing) * scale;
  }
}

function drawRow(ctx: CanvasRenderingContext2D, font: Font, slot: RowSlot, layout: SheetLayout, c: SheetColors, spacing: number): void {
  const { scale } = layout;
  const r = slot.row;
  const marker = r.unseenImprovement ? '*' : r.selected ? '+' : '';
  drawText(ctx, font, r.label + marker, slot.label.x, slot.label.y + scale, scale, c.text, spacing);
  ctx.fillStyle = c.barTrack;
  ctx.fillRect(slot.bar.x, slot.bar.y, slot.bar.width, slot.bar.height);
  ctx.fillStyle = r.fraction < 0.25 ? c.barLow : c.barFill;
  ctx.fillRect(slot.bar.x, slot.bar.y, Math.floor(slot.bar.width * r.fraction), slot.bar.height);
  const color = r.modifier > 0 ? c.bonus : r.modifier < 0 ? c.penalty : c.text;
  drawText(ctx, font, formatSkillValue(r), slot.value.x, slot.value.y + scale, scale, color, spacing);
}

/** Draw the character sheet. Uses fillRect per glyph pixel, so scaling stays crisp. */
export function drawCharacterSheet(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: SheetLayout,
  model: SheetModel,
  state: SheetState,
  opts: { spacing?: number; colors?: SheetColors } = {},
): void {
  const c = opts.colors ?? DEFAULT_SHEET_COLORS;
  const spacing = opts.spacing ?? 0;
  const { scale, panel } = layout;

  ctx.fillStyle = c.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = scale;
  ctx.strokeRect(panel.x + scale / 2, panel.y + scale / 2, panel.width - scale, panel.height - scale);

  for (const t of layout.tabs) {
    ctx.fillStyle = t.index === state.tab ? c.tabSelected : c.tab;
    ctx.fillRect(t.rect.x, t.rect.y, t.rect.width - scale, t.rect.height);
    drawText(ctx, font, t.label, t.rect.x + 2 * scale, t.rect.y + 2 * scale, scale, t.index === state.tab ? c.text : c.dim, spacing);
  }

  drawText(ctx, font, model.name, layout.title.x, layout.title.y, scale, c.text, spacing);
  for (const slot of [...layout.vitals, ...layout.attributes, ...layout.skills]) drawRow(ctx, font, slot, layout, c, spacing);

  drawText(ctx, font, 'Conditions', layout.conditionsHeader.x, layout.conditionsHeader.y, scale, c.dim, spacing);
  if (layout.conditions.length === 0) {
    drawText(ctx, font, 'None', layout.conditionsHeader.x, layout.conditionsHeader.y + layout.rowHeight, scale, c.text, spacing);
  }
  for (const slot of layout.conditions) {
    drawText(ctx, font, `${slot.condition.label} ${slot.condition.value}%`, slot.rect.x, slot.rect.y, scale, c.condition, spacing);
  }
}
