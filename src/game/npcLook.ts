import type { PlacedEncounter } from '../world/encounters';

/**
 * How a dialogue NPC is drawn: which standing-figure model, what colours, where it stands.
 * Pure functions; the three.js side is src/render/npcFigures.ts.
 */

export type NpcVariant = 'man' | 'woman' | 'guard' | 'noble' | 'monk' | 'moredhel' | 'dwarf';

export const NPC_VARIANTS: readonly NpcVariant[] = ['man', 'woman', 'guard', 'noble', 'monk', 'moredhel', 'dwarf'];

const RULES: readonly (readonly [RegExp, NpcVariant])[] = [
  [/\b(brother|sister|father|abbot|priest|monk|prelate|acolyte|friar|bishop)\b/i, 'monk'],
  [/\b(moredhel|elf|elven|ranger|dark)\b/i, 'moredhel'],
  [/\b(dwarf|dolgan|dwarven)\b/i, 'dwarf'],
  [/\b(captain|sergeant|guard|soldier|knight|sentry|marshal|warden|trooper|officer)\b/i, 'guard'],
  [/\b(lady|princess|queen|mistress|madam|widow|girl|maid|mother|innkeeperess)\b/i, 'woman'],
  [/\b(duke|lord|count|baron|prince|squire|king|earl|sir|master|magistrate|prelate|chancellor)\b/i, 'noble'],
];

/** The model for an NPC, from the title words in the name; commoner by default. */
export function npcVariant(name: string): NpcVariant {
  for (const [re, variant] of RULES) if (re.test(name)) return variant;
  return 'man';
}

export type Rgb = readonly [number, number, number];

export interface ClothingColors {
  /** Tunic, robe or cloak. */
  primary: Rgb;
  /** Trousers or skirt. */
  secondary: Rgb;
}

const rgbToHsv = (r: number, g: number, b: number): [number, number, number] => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, max === 0 ? 0 : d / max, max];
};

/** Skin tones in the portraits are orange-pink at middling saturation; clothing is picked from what is left. */
const isSkin = (h: number, s: number, v: number) => (h < 45 || h > 345) && s > 0.2 && s < 0.65 && v > 0.35;

/** Portraits are painted dark; as a model tint that would give black cloth, so lift the brightest channel to at least 0.3. */
const lift = (c: Rgb): Rgb => {
  const k = Math.max(1, 0.3 / Math.max(c[0], c[1], c[2], 0.01));
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
};

/**
 * Pick clothing colours from a portrait's pixels (RGBA, 0-255): the most common saturated colour that
 * is not skin or near-black is the tunic; the next one that differs clearly is the trousers (else a
 * darker tunic colour). The top 30% of the picture (face and hair) is ignored.
 */
export function clothingColors(data: ArrayLike<number>, width: number, height: number): ClothingColors {
  const buckets = new Map<number, { score: number; r: number; g: number; b: number; n: number }>();
  for (let y = Math.floor(height * 0.3); y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if ((data[i + 3] ?? 255) < 128) continue;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255);
      if (v < 0.12 || isSkin(h, s, v)) continue;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const e = buckets.get(key) ?? { score: 0, r: 0, g: 0, b: 0, n: 0 };
      e.score += 0.4 + s; // favour colourful regions over grey ones
      e.r += r;
      e.g += g;
      e.b += b;
      e.n++;
      buckets.set(key, e);
    }
  }
  const ranked = [...buckets.values()].sort((a, b) => b.score - a.score);
  const avg = (e: { r: number; g: number; b: number; n: number }): Rgb => [
    e.r / e.n / 255,
    e.g / e.n / 255,
    e.b / e.n / 255,
  ];
  const top = ranked[0];
  if (!top) return { primary: [0.55, 0.45, 0.35], secondary: [0.4, 0.33, 0.27] };
  const primary = lift(avg(top));
  const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const other = ranked
    .slice(1)
    .map(avg)
    .find((c) => dist(c, primary) > 0.3);
  return { primary, secondary: lift(other ?? [primary[0] * 0.6, primary[1] * 0.6, primary[2] * 0.6]) };
}

export interface NpcPlacement {
  /** BaK world position of the figure. */
  x: number;
  y: number;
}

/** The figure stands at the centre of the encounter's trigger rectangle. */
export function npcPlacement(e: PlacedEncounter): NpcPlacement {
  return { x: (e.minX + e.maxX) / 2, y: (e.minY + e.maxY) / 2 };
}
