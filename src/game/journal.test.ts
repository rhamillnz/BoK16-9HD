import { describe, expect, it, beforeEach } from 'vitest';
import { addNote, clearJournal, journalEntries, JOURNAL_LIMIT, noteText, parseJournal } from './journal';
import { captureSaveExtras, restoreSaveExtras } from './saveExtras';
import { clipLine, layoutJournal, stepJournal, initialJournalState } from '../ui/journalScreen';
import type { Font } from '../formats/fnt';

const long = (n: number) => `The old man says a thing worth remembering, number ${n}.`;

describe('journal', () => {
  beforeEach(clearJournal);

  it('keeps long lines newest first and skips short ones', () => {
    expect(addNote('Yes.', 1)).toBe(false);
    addNote(long(1), 1);
    addNote(long(2), 2);
    expect(journalEntries().map((e) => e.zone)).toEqual([2, 1]);
  });

  it('moves a repeated line to the top instead of duplicating it', () => {
    addNote(long(1), 1);
    addNote(long(2), 1);
    addNote(long(1), 3);
    expect(journalEntries()).toHaveLength(2);
    expect(journalEntries()[0]).toEqual({ text: noteText(long(1)), zone: 3 });
  });

  it('drops the oldest beyond the limit', () => {
    for (let i = 0; i < JOURNAL_LIMIT + 5; i++) addNote(long(i), 1);
    expect(journalEntries()).toHaveLength(JOURNAL_LIMIT);
    expect(journalEntries()[JOURNAL_LIMIT - 1]!.text).toContain('number 5.');
  });

  it('round-trips through the save extras and tolerates old saves', () => {
    addNote(long(1), 4);
    const saved = JSON.parse(JSON.stringify(captureSaveExtras())) as Record<string, unknown>;
    clearJournal();
    restoreSaveExtras(saved);
    expect(journalEntries()).toEqual([{ text: noteText(long(1)), zone: 4 }]);
    restoreSaveExtras({});
    expect(journalEntries()).toEqual([]);
    expect(parseJournal([{ text: 1 }, null, { text: 'ok', zone: 2 }])).toEqual([{ text: 'ok', zone: 2 }]);
  });
});

describe('journal screen', () => {
  const font = { height: 8, firstChar: 0, maxWidth: 6, glyphs: [{ width: 6, height: 8, pixels: new Uint8Array(48) }] } as unknown as Font;
  it('scrolls the window to follow the selection and clamps at the ends', () => {
    const layout = layoutJournal(2560, 1440, 4);
    let s = initialJournalState();
    for (let i = 0; i < 6; i++) s = stepJournal(layout, s, 10, { type: 'key', key: 'ArrowDown' });
    expect(s).toEqual({ selected: 6, top: 3 });
    s = stepJournal(layout, s, 10, { type: 'key', key: 'End' });
    expect(s.selected).toBe(9);
    s = stepJournal(layout, s, 10, { type: 'key', key: 'ArrowDown' });
    expect(s.selected).toBe(9);
    s = stepJournal(layout, s, 10, { type: 'key', key: 'Home' });
    expect(s).toEqual({ selected: 0, top: 0 });
  });
  it('clips long lines with an ellipsis', () => {
    expect(clipLine(font, 'abc', 100)).toBe('abc');
    expect(clipLine(font, 'abcdefghij', 30).endsWith('...')).toBe(true);
  });
});
