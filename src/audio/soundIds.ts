/** Sound numbers in FRP.SX that the game plays, as used by the original (docs/formats/sound.md §4). */
export const Snd = {
  pickBroke: 0x05,
  parrySword: 7,
  teleport: 0x0c,
  missSwing: 19,
  pickedLock: 0x16,
  missThrust: 25,
  zap: 26,
  useKey: 0x1e,
  openLock: 30,
  doorOpen: 38,
  doorClose: 39,
  keyBroke: 0x2b,
  useRope: 0x32,
  explosion: 0x39,
  buy: 60,
  drag: 61,
  bless: 0x3e,
  swordHit: 65,
  staffHit: 66,
  parryStaff: 67,
  fistHit: 74,
} as const;

/** Monsters that hit with fists, and those that zap, in the original's melee sound choice. */
const FIST_MONSTERS = new Set([19, 28, 41, 42, 43, 46, 48]);
const ZAP_MONSTERS = new Set([39, 44, 49, 58]);

export function attackHitSound(monster: number): number {
  if (FIST_MONSTERS.has(monster)) return Snd.fistHit;
  if (ZAP_MONSTERS.has(monster)) return Snd.zap;
  return Snd.swordHit;
}
