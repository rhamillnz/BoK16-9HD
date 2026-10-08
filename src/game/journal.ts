import { splitParagraphs } from '../ui/dialogBox';
import { registerSaveExtra } from './saveExtras';

/** One remembered line of dialogue. */
export interface JournalEntry {
  text: string;
  /** Zone the party was in when the line was shown. */
  zone: number;
}

/** Most entries kept; the oldest drop off first. */
export const JOURNAL_LIMIT = 200;
/** Lines shorter than this are not worth keeping (greetings, "Yes."). */
export const MIN_NOTE_LENGTH = 24;

let entries: JournalEntry[] = [];

/** Plain text of a dialogue string: control codes removed, paragraphs joined with a space. */
export function noteText(raw: string): string {
  return splitParagraphs(raw).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
}

/** Remember a dialogue line. Repeats move to the top rather than appearing twice. Returns whether it was kept. */
export function addNote(raw: string, zone: number): boolean {
  const text = noteText(raw);
  if (text.length < MIN_NOTE_LENGTH) return false;
  entries = [{ text, zone }, ...entries.filter((e) => e.text !== text)].slice(0, JOURNAL_LIMIT);
  return true;
}

/** Newest first. */
export function journalEntries(): readonly JournalEntry[] {
  return entries;
}

export function clearJournal(): void {
  entries = [];
}

/** Read a saved journal, ignoring anything malformed (older saves have none). */
export function parseJournal(data: unknown): JournalEntry[] {
  if (!Array.isArray(data)) return [];
  const out: JournalEntry[] = [];
  for (const e of data) {
    if (e && typeof e === 'object' && typeof (e as JournalEntry).text === 'string' && typeof (e as JournalEntry).zone === 'number') {
      out.push({ text: (e as JournalEntry).text, zone: (e as JournalEntry).zone });
    }
  }
  return out.slice(0, JOURNAL_LIMIT);
}

registerSaveExtra('journal', {
  capture: () => entries.map((e) => ({ ...e })),
  restore: (data) => {
    entries = parseJournal(data);
  },
});
