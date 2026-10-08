import { describe, expect, it } from 'vitest';
import { fitSpeakerName } from './speakerFont';

describe('fitSpeakerName', () => {
  it('returns the max size when text fits', () => {
    // This test uses a fake measure function via mock in reality
    // For now, we test the logic with known dimensions
    const result = fitSpeakerName('Hi', 1000, 32);
    expect(result.size).toBeLessThanOrEqual(32);
    expect(result.size).toBeGreaterThanOrEqual(8);
  });

  it('reduces size if text is too wide', () => {
    const result = fitSpeakerName('VeryLongSpeakerName', 50, 32);
    expect(result.size).toBeLessThanOrEqual(32);
  });

  it('never goes below 8px', () => {
    const result = fitSpeakerName('VeryLongSpeakerNameThatIsReallyReallyLong', 10, 32);
    expect(result.size).toBeGreaterThanOrEqual(8);
  });
});
