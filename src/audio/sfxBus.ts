/**
 * Fire-and-forget sound effects. Game modules call `playSfx(id)` with a sound number from FRP.SX
 * (see soundIds.ts); `installSfx` plugs the player in. With no player installed (tests, no game
 * data) the calls do nothing.
 */
export type SfxHandler = (soundId: number) => void;

let handler: SfxHandler | undefined;

export function setSfxHandler(h: SfxHandler | undefined): void {
  handler = h;
}

export function playSfx(soundId: number, times = 1): void {
  if (!handler) return;
  for (let i = 0; i < times; i++) handler(soundId);
}
