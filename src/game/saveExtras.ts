/**
 * Extra save-game sections owned by feature modules (container contents, shop stock...). A module
 * registers a section by name; saves carry `extras[name]` and loads hand it back, `undefined` when
 * the save predates the section. Keeps feature state out of main.ts and the core save format.
 */
export interface SaveExtra {
  /** JSON-able snapshot of the section. */
  capture(): unknown;
  /** Replace the section with a snapshot, or reset it when `data` is undefined. */
  restore(data: unknown | undefined): void;
}

const sections = new Map<string, SaveExtra>();

export function registerSaveExtra(name: string, extra: SaveExtra): void {
  sections.set(name, extra);
}

export function captureSaveExtras(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, s] of sections) out[name] = s.capture();
  return out;
}

export function restoreSaveExtras(extras: Record<string, unknown> | undefined): void {
  for (const [name, s] of sections) s.restore(extras?.[name]);
}
