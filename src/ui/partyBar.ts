import { toRGBA, type IndexedImage } from '../formats/bmx';
import type { Palette } from '../formats/palette';
import { effectiveSkill, type Character, type GamSave } from '../formats/gam';
import { glyphFor, measureString, type Font } from '../formats/fnt';
import { HUD_HEIGHT, HUD_WIDTH, type Rect } from './dialogBox';
import { partyCharacters } from './characterSheet';

/**
 * Party bar along the bottom of the main view. Each active member gets a slot with the portrait
 * (image `character.index` of HEADS.BMX, drawn with OPTIONS.PAL, as the original does for its
 * main-view heads), the name, and health and stamina bars. Slot positions are our own: the
 * original places three heads from REQ_MAIN.DAT inside FRAME.SCX, which does not suit a 16:9 HUD.
 */

/** Native size of a HEADS.BMX portrait when none is loaded (layout only; drawing uses the real image). */
export const DEFAULT_PORTRAIT_SIZE = { width: 32, height: 32 } as const;
export const MAX_PARTY_SLOTS = 6;

export interface PartyBarMember {
  /** Character index (0..5): selects the portrait. */
  index: number;
  name: string;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  /** health / maxHealth in 0..1. */
  healthFraction: number;
  staminaFraction: number;
  /** Health at 0: the portrait is drawn dimmed. */
  down: boolean;
}

export function fraction(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
}

/** Display values for one member; current values come from `effectiveSkill`, never `skill.current`. */
export function buildPartyBarMember(c: Character): PartyBarMember {
  const health = effectiveSkill(c, 'health');
  const stamina = effectiveSkill(c, 'stamina');
  const maxHealth = effectiveSkill(c, 'health', 'max');
  const maxStamina = effectiveSkill(c, 'stamina', 'max');
  return {
    index: c.index,
    name: c.name,
    health,
    maxHealth,
    stamina,
    maxStamina,
    healthFraction: fraction(health, maxHealth),
    staminaFraction: fraction(stamina, maxStamina),
    down: health <= 0,
  };
}

export function buildPartyBar(save: Pick<GamSave, 'characters' | 'activeCharacters'>): PartyBarMember[] {
  return partyCharacters(save).slice(0, MAX_PARTY_SLOTS).map(buildPartyBarMember);
}

export interface PartyBarOptions {
  canvasWidth?: number;
  canvasHeight?: number;
  /** Integer pixel-font / art scale (>= 1). */
  scale?: number;
  portrait?: { width: number; height: number };
}

export interface PartyBarSlot {
  index: number;
  rect: Rect;
  portrait: Rect;
  name: { x: number; y: number };
  /** Space for the name: names are ellipsized to fit. */
  nameWidth: number;
  healthBar: Rect;
  staminaBar: Rect;
}

export interface PartyBarLayout {
  scale: number;
  panel: Rect;
  slots: PartyBarSlot[];
}

export function defaultPartyBarOptions(canvasWidth = HUD_WIDTH, canvasHeight = HUD_HEIGHT): Required<PartyBarOptions> {
  return {
    canvasWidth,
    canvasHeight,
    scale: Math.max(1, Math.floor(canvasHeight / 360)),
    portrait: { ...DEFAULT_PORTRAIT_SIZE },
  };
}

/** Lay `count` slots out in a centred panel flush with the bottom edge of the canvas. */
export function layoutPartyBar(font: Font, count: number, options: PartyBarOptions = {}): PartyBarLayout {
  const o = { ...defaultPartyBarOptions(options.canvasWidth, options.canvasHeight), ...options };
  const s = o.scale;
  const pad = 3 * s;
  const gap = 3 * s;
  const portraitW = o.portrait.width * s;
  const portraitH = o.portrait.height * s;
  const barW = 40 * s;
  const barH = 3 * s;
  const slotW = portraitW + pad + barW;
  const slotH = Math.max(portraitH, font.height * s + 2 * (barH + s) + pad);
  const n = Math.max(0, Math.min(count, MAX_PARTY_SLOTS));
  const innerW = n * slotW + Math.max(0, n - 1) * gap;
  const panel: Rect = {
    x: Math.floor((o.canvasWidth - (innerW + 2 * pad)) / 2),
    y: o.canvasHeight - (slotH + 2 * pad),
    width: innerW + 2 * pad,
    height: slotH + 2 * pad,
  };
  const slots: PartyBarSlot[] = [];
  for (let i = 0; i < n; i++) {
    const x = panel.x + pad + i * (slotW + gap);
    const y = panel.y + pad;
    const bx = x + portraitW + pad;
    const rect: Rect = { x, y, width: slotW, height: slotH };
    slots.push({
      index: i,
      rect,
      portrait: { x, y, width: portraitW, height: portraitH },
      name: { x: bx, y },
      nameWidth: barW,
      healthBar: { x: bx, y: y + font.height * s + s, width: barW, height: barH },
      staminaBar: { x: bx, y: y + font.height * s + s + barH + s, width: barW, height: barH },
    });
  }
  return { scale: s, panel, slots };
}

/** Index of the slot under (x, y), or -1. */
export function partySlotAt(layout: PartyBarLayout, x: number, y: number): number {
  for (const s of layout.slots) {
    const r = s.rect;
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return s.index;
  }
  return -1;
}

/** Shorten `text` with "..." so it measures at most `maxPx` source pixels wide. */
export function ellipsize(font: Font, text: string, maxPx: number, spacing = 0): string {
  if (measureString(font, text, spacing) <= maxPx) return text;
  let t = text;
  while (t.length > 0 && measureString(font, `${t}...`, spacing) > maxPx) t = t.slice(0, -1);
  return `${t}...`;
}

export interface PartyBarColors {
  background: string;
  border: string;
  slot: string;
  text: string;
  barTrack: string;
  health: string;
  healthLow: string;
  stamina: string;
  down: string;
}

export const DEFAULT_PARTY_BAR_COLORS: PartyBarColors = {
  background: 'rgba(24, 16, 8, 0.92)',
  border: '#c8a050',
  slot: '#382818',
  text: '#f0e0b8',
  barTrack: '#2a1c0c',
  health: '#b83a2a',
  healthLow: '#e8602a',
  stamina: '#c8a838',
  down: 'rgba(0, 0, 0, 0.55)',
};

/** Portraits by character index (HEADS.BMX order); a missing entry draws a plain slot. */
export type PortraitSet = ReadonlyArray<CanvasImageSource | undefined>;

function drawText(
  ctx: CanvasRenderingContext2D,
  font: Font,
  text: string,
  x: number,
  y: number,
  scale: number,
  css: string,
): void {
  ctx.fillStyle = css;
  let gx = x;
  for (let i = 0; i < text.length; i++) {
    const g = glyphFor(font, text.charCodeAt(i));
    for (let py = 0; py < g.height; py++) {
      for (let px = 0; px < g.width; px++) {
        if (g.pixels[py * g.width + px] !== 0) ctx.fillRect(gx + px * scale, y + py * scale, scale, scale);
      }
    }
    gx += g.width * scale;
  }
}

function drawBar(ctx: CanvasRenderingContext2D, r: Rect, fill: number, track: string, color: string): void {
  ctx.fillStyle = track;
  ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, Math.floor(r.width * fill), r.height);
}

/** Draw the bar. Does not clear the canvas; the caller composes it with other HUD layers. */
export function drawPartyBar(
  ctx: CanvasRenderingContext2D,
  font: Font,
  layout: PartyBarLayout,
  members: readonly PartyBarMember[],
  portraits: PortraitSet = [],
  colors: PartyBarColors = DEFAULT_PARTY_BAR_COLORS,
): void {
  if (layout.slots.length === 0) return;
  const { scale: s, panel } = layout;
  ctx.fillStyle = colors.background;
  ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = s;
  ctx.strokeRect(panel.x + s / 2, panel.y + s / 2, panel.width - s, panel.height - s);

  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (const slot of layout.slots) {
    const m = members[slot.index];
    if (!m) continue;
    const p = slot.portrait;
    ctx.fillStyle = colors.slot;
    ctx.fillRect(p.x, p.y, p.width, p.height);
    const img = portraits[m.index];
    if (img) ctx.drawImage(img, p.x, p.y, p.width, p.height);
    if (m.down) {
      ctx.fillStyle = colors.down;
      ctx.fillRect(p.x, p.y, p.width, p.height);
    }
    drawText(ctx, font, ellipsize(font, m.name, slot.nameWidth / s), slot.name.x, slot.name.y, s, colors.text);
    drawBar(
      ctx,
      slot.healthBar,
      m.healthFraction,
      colors.barTrack,
      m.healthFraction < 0.25 ? colors.healthLow : colors.health,
    );
    drawBar(ctx, slot.staminaBar, m.staminaFraction, colors.barTrack, colors.stamina);
  }
  ctx.imageSmoothingEnabled = smoothing;
}

/** Convert HEADS.BMX images (palette OPTIONS.PAL) into canvases, in character-index order. */
export function portraitCanvases(images: readonly IndexedImage[], palette: Palette): HTMLCanvasElement[] {
  return images.map((img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.putImageData(new ImageData(toRGBA(img, palette), img.width, img.height), 0, 0);
    return canvas;
  });
}
