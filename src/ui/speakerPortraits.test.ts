import { describe, expect, it } from 'vitest';
import { speakerPortraitFiles } from './speakerPortraits';

describe('speakerPortraitFiles', () => {
  it('zero-pads the actor number', () => {
    expect(speakerPortraitFiles(1)).toEqual({ bmx: 'ACT001.BMX', pal: 'ACT001.PAL' });
    expect(speakerPortraitFiles(53)).toEqual({ bmx: 'ACT053.BMX', pal: 'ACT053.PAL' });
  });
  it('adds the A suffix to the image only for actors 9, 12, 18 and 30', () => {
    for (const a of [9, 12, 18, 30]) {
      const n = String(a).padStart(3, '0');
      expect(speakerPortraitFiles(a)).toEqual({ bmx: `ACT${n}A.BMX`, pal: `ACT${n}.PAL` });
    }
  });
});
