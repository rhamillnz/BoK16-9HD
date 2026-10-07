import { parseDDX, type DialogFile } from '../formats/ddx';
import type { ResourceArchive } from '../formats/archive';
import { parseTownTable } from '../formats/gds';
import { tileName } from '../formats/world';
import { EncounterMap } from '../world/encounters';
import {
  DialogStore,
  EncounterRunner,
  parseDefDialog,
  parseKeywords,
  runDialogSession,
  type DialogEnv,
  type EncounterEvent,
  type ShowDialog,
} from './encounterRunner';
import type { WorldState } from './state';
import { parseZoneTransitions } from './transitions';

/** Reads a named resource from the archive or install directory; undefined when it does not exist. */
export type ReadResource = (name: string) => Uint8Array | undefined;

export const DIALOG_FILE_COUNT = 32;

/** Every resource `loadEncounterRunner` may read for a zone. */
export function encounterResourceNames(zone: number, tiles: readonly (readonly [number, number])[]): string[] {
  return [
    ...tiles.map(([x, y]) => tileName(zone, x, y, 'DAT')),
    'DEF_DIAL.DAT',
    'DEF_BLOC.DAT',
    'DEF_ZONE.DAT',
    'DEF_TOWN.DAT',
    'DEF_BKGR.DAT',
    'TELEPORT.DAT',
    'KEYWORD.DAT',
    ...Array.from({ length: DIALOG_FILE_COUNT }, (_, n) => dialogFileName(n)),
  ];
}

/** Fetch what is needed up front: from the archive when present, else the install directory (/bak/). */
export async function prefetchResources(archive: ResourceArchive, names: readonly string[]): Promise<ReadResource> {
  const found = new Map<string, Uint8Array>();
  await Promise.all(
    names.map(async (name) => {
      if (archive.has(name)) return void found.set(name, archive.get(name));
      const res = await fetch(`/bak/${name}`).catch(() => undefined);
      if (res?.ok) found.set(name, new Uint8Array(await res.arrayBuffer()));
    }),
  );
  return (name) => found.get(name);
}

export const dialogFileName = (n: number) => `DIAL_Z${String(n).padStart(2, '0')}.DDX`;

/** Load one zone's encounters, the dialogue files and the definition tables they point at. */
export function loadEncounterRunner(opts: {
  read: ReadResource;
  zone: number;
  /** The zone's tiles in ZxxREF.DAT order; the position is the tile index addressing encounter flags. */
  tiles: readonly (readonly [number, number])[];
  chapter: number;
  world: WorldState;
  env?: DialogEnv;
}): EncounterRunner {
  const { read, zone, tiles, chapter } = opts;
  const map = new EncounterMap(chapter);
  const indexOf = new Map<number, number>();
  tiles.forEach(([x, y], i) => {
    indexOf.set(y * 1024 + x, i);
    const bytes = read(tileName(zone, x, y, 'DAT'));
    if (bytes) map.addTile(x, y, bytes);
  });

  const files = new Map<number, DialogFile>();
  for (let n = 0; n < DIALOG_FILE_COUNT; n++) {
    const bytes = read(dialogFileName(n));
    if (bytes) files.set(n, parseDDX(bytes));
  }
  const table = (name: string) => {
    const bytes = read(name);
    return bytes ? parseDefDialog(bytes) : [];
  };
  const keywords = read('KEYWORD.DAT');
  return new EncounterRunner({
    map,
    world: opts.world,
    zone,
    tileIndex: (x, y) => indexOf.get(y * 1024 + x) ?? 0,
    store: new DialogStore(files),
    defDial: table('DEF_DIAL.DAT'),
    defBloc: table('DEF_BLOC.DAT'),
    defZone: read('DEF_ZONE.DAT') ? parseZoneTransitions(read('DEF_ZONE.DAT')!) : [],
    defTown: read('DEF_TOWN.DAT') ? parseTownTable(read('DEF_TOWN.DAT')!) : [],
    defBackground: read('DEF_BKGR.DAT') ? parseTownTable(read('DEF_BKGR.DAT')!) : [],
    keywords: keywords ? parseKeywords(keywords) : [],
    env: opts.env,
  });
}

export interface EncounterHooks {
  /** An encounter type that is not run yet (combat, town, zone...). */
  other?: (e: Extract<EncounterEvent, { type: 'other' }>) => void;
  /** A zone encounter without a dialogue fired: the party should leave now. */
  zone?: (e: Extract<EncounterEvent, { type: 'zone' }>) => void;
  /** A town or background encounter without an entry dialogue fired: the party enters the scene now. */
  town?: (e: Extract<EncounterEvent, { type: 'town' }>) => void;
  /** A block encounter fired: undo the party's last step. */
  blocked?: () => void;
  /** A dialogue ended; effects the runner could not apply are on the session. */
  finished?: (e: Extract<EncounterEvent, { type: 'dialog' }>, cancelled: boolean) => void;
}

/**
 * Feeds the party position to an `EncounterRunner` and plays the dialogues it starts one at a time.
 * Call `update` every frame; it does nothing while a dialogue is open.
 */
export class EncounterDriver {
  private queue: Extract<EncounterEvent, { type: 'dialog' }>[] = [];
  private active = false;

  constructor(
    readonly runner: EncounterRunner,
    private readonly show: ShowDialog,
    private readonly hooks: EncounterHooks = {},
  ) {}

  get busy(): boolean {
    return this.active;
  }

  update(x: number, y: number): void {
    if (this.active) return;
    for (const ev of this.runner.update(x, y)) {
      if (ev.type === 'other') this.hooks.other?.(ev);
      else if (ev.type === 'zone') this.hooks.zone?.(ev);
      else if (ev.type === 'town') this.hooks.town?.(ev);
      else this.queue.push(ev);
    }
    this.next();
  }

  private next(): void {
    const ev = this.queue.shift();
    if (!ev) {
      this.active = false;
      return;
    }
    this.active = true;
    if (ev.blocks) this.hooks.blocked?.();
    runDialogSession(ev.session, this.show, (cancelled) => {
      this.runner.finish(ev.session);
      this.hooks.finished?.(ev, cancelled);
      this.next();
    });
  }
}
