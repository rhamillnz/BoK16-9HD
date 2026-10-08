import { describe, expect, it } from 'vitest';
import { resolveSpeaker, type SpeakerContext } from './speaker';

const keywords: string[] = [];
keywords[293 + 20] = 'Squire Locklear';
keywords[293 + 7] = 'Prince Arutha';
const ctx: SpeakerContext = {
  keywords,
  dialogCharacters: [0xff, 0xff, 2, 0xff, 0xff, 3],
  leader: 4,
  firstActive: 1,
};

describe('resolveSpeaker', () => {
  it('has no speaker for 0 and 0xc8', () => {
    expect(resolveSpeaker(0, ctx)).toBeUndefined();
    expect(resolveSpeaker(0xc8, ctx)).toBeUndefined();
  });
  it('maps actors 1-6 to party members', () => {
    expect(resolveSpeaker(1, ctx)).toEqual({ actor: 1, name: 'Locklear' });
    expect(resolveSpeaker(6, ctx)).toEqual({ actor: 6, name: 'Patrus' });
    expect(resolveSpeaker(3, { ...ctx, characterName: () => 'Renamed' })?.name).toBe('Renamed');
  });
  it('resolves 0xff to the first active member and 0xfe to the leader', () => {
    expect(resolveSpeaker(0xff, ctx)).toEqual({ actor: 2, name: 'Gorath' });
    expect(resolveSpeaker(0xfe, ctx)).toEqual({ actor: 5, name: 'James' });
    expect(resolveSpeaker(0xfe, { keywords })).toBeUndefined();
  });
  it('resolves dialogue character list entries', () => {
    expect(resolveSpeaker(0xf2, ctx)).toEqual({ actor: 3, name: 'Owyn' });
    expect(resolveSpeaker(0xfd, ctx)).toEqual({ actor: 4, name: 'Pug' });
    expect(resolveSpeaker(0xf0, ctx)).toBeUndefined();
  });
  it('names NPCs from KEYWORD.DAT at actor + 293', () => {
    expect(resolveSpeaker(20, ctx)).toEqual({ actor: 20, name: 'Squire Locklear' });
    expect(resolveSpeaker(7, ctx)?.name).toBe('Prince Arutha');
    expect(resolveSpeaker(30, ctx)).toBeUndefined();
  });
});
