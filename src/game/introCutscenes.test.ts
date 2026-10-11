import { describe, expect, it } from 'vitest';
import { chapterStartCutscenes, introCutscenes } from './cutscene';

describe('introCutscenes', () => {
  it('plays the title animation, then the whole start of chapter 1', () => {
    const steps = introCutscenes();
    expect(steps[0]).toEqual({ kind: 'ttm', ads: 'INTRO.ADS', ttm: 'INTRO.TTM' });
    expect(steps.slice(1)).toEqual(chapterStartCutscenes(1));
    expect(steps.map((s) => (s.kind === 'ttm' ? s.ttm : s.file))).toEqual([
      'INTRO.TTM',
      'CHAPTER1.TTM',
      'C11.BOK',
      'C11.TTM',
    ]);
  });
});
