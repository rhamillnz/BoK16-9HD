/**
 * Picking a combat sprite for a monster. COMBAT.TBL holds one model per monster whose first mesh is
 * the Idle animation; its first face option is the South-facing frame 0. The sprite sheet is
 * `<prefix><suffix0>.BMX` from BNAMES.DAT (BaKGL's idle mesh always uses the first sheet). Colour swaps
 * (CSn.DAT) are not applied yet, so monsters that differ only by palette look alike.
 */

import type { IndexedImage } from '../formats/bmx';
import type { ModelTable } from '../formats/tbl';
import type { MonsterSprites } from './monsters';

export interface CombatSprite {
  image: IndexedImage;
  /** Size of the billboard in BaK world units. */
  width: number;
  height: number;
}

/** Original VGA pixels were 1.2x taller than wide (same factor as zone sprites). */
const VGA_PIXEL_STRETCH = 1.2;

export const spriteSheetName = (s: MonsterSprites): string => `${s.prefix.toUpperCase()}${s.suffixes[0]}.BMX`;

export function combatSprite(
  monster: number,
  table: Pick<ModelTable, 'models'>,
  sets: readonly MonsterSprites[],
  loadSheet: (name: string) => readonly IndexedImage[] | undefined,
): CombatSprite | undefined {
  const model = table.models[monster];
  const set = sets[monster];
  if (!model?.sprite || !set || set.prefix === '') return undefined;
  const image = loadSheet(spriteSheetName(set))?.[model.sprite.index];
  if (!image || image.width === 0 || image.height === 0) return undefined;
  const sf = model.sprite.scale === 0 ? 256 : model.sprite.scale;
  const major = ((2 * model.radius * sf) / 256) * model.scale;
  const maxDim = Math.max(image.width, image.height);
  return {
    image,
    width: (image.width / maxDim) * major,
    height: (image.height / maxDim) * major * VGA_PIXEL_STRETCH,
  };
}
