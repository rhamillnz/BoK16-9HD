import type { ResourceArchive } from '../formats/archive';
import { parseDDX } from '../formats/ddx';
import type { DialogFile } from '../formats/ddx';
import { DIALOG_FILE_COUNT, dialogFileName, prefetchResources } from './encounterDriver';
import { DialogStore } from './encounterRunner';
import { wordLockKey } from './wordLock';

export interface ContainerData {
  /** `OBJFIXED.DAT`, when present. */
  fixedObjects: Uint8Array | undefined;
  /** Riddle text of word-lock chest `index`, cleaned of style control bytes. */
  riddleText(index: number): string | undefined;
}

/** Keep line breaks, drop other control bytes and the high style bytes (like 0xF7) the dialogue text carries. */
export const cleanRiddleText = (text: string): string => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-ÿ]/g, '');

/** Build a riddle lookup over a set of parsed dialogue files. */
export function riddleLookup(files: Map<number, DialogFile>): (index: number) => string | undefined {
  const store = new DialogStore(files);
  return (index) => {
    const ref = store.byKey(wordLockKey(index));
    return ref && cleanRiddleText(ref.snippet.text);
  };
}

/** Fetch what the container system reads from the game install. */
export async function loadContainerData(archive: ResourceArchive): Promise<ContainerData> {
  const names = ['OBJFIXED.DAT', ...Array.from({ length: DIALOG_FILE_COUNT }, (_, n) => dialogFileName(n))];
  const read = await prefetchResources(archive, names);
  const files = new Map<number, DialogFile>();
  for (let n = 0; n < DIALOG_FILE_COUNT; n++) {
    const bytes = read(dialogFileName(n));
    if (bytes) files.set(n, parseDDX(bytes));
  }
  return { fixedObjects: read('OBJFIXED.DAT'), riddleText: riddleLookup(files) };
}
