import { describe, expect, it } from 'vitest';
import { cleanRiddleText } from './containerData';
import { captureSaveExtras, registerSaveExtra, restoreSaveExtras } from './saveExtras';
import { deserializeSave, serializeSave, type SaveGameData } from './saveGame';

describe('save extras', () => {
  it('captures every registered section and hands each back on restore', () => {
    let a = 1;
    registerSaveExtra('test-a', { capture: () => a, restore: (d) => (a = (d as number | undefined) ?? 0) });
    expect(captureSaveExtras()['test-a']).toBe(1);
    restoreSaveExtras({ 'test-a': 7 });
    expect(a).toBe(7);
    restoreSaveExtras(undefined);
    expect(a).toBe(0);
  });

  it('extras survive the JSON save format and are optional', () => {
    const data = {
      savedAt: 1,
      zone: 1,
      x: 0,
      y: 0,
      heading: 0,
      world: { chapter: 1, ticks: 0, ticksLastSlept: 0, bytes: new Uint8Array(4), expiringEvents: [] },
      party: { gold: 0, characters: [], activeCharacters: [], partyKeys: { capacity: 1, items: [] } },
      extras: { containers: { '1:0': { items: [], unlocked: true, trapSpent: false } } },
    } as unknown as SaveGameData;
    expect(deserializeSave(serializeSave(data)).extras).toEqual(data.extras);
    expect(deserializeSave(serializeSave({ ...data, extras: undefined })).extras).toBeUndefined();
  });
});

describe('riddle text', () => {
  it('drops style bytes but keeps line breaks and letters', () => {
    expect(cleanRiddleText('÷OAK\n#\nASH\u0001\n#hint')).toBe('OAK\n#\nASH\n#hint');
  });
});
