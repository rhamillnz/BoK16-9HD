import { describe, expect, it } from 'vitest';
import { POST_PRESETS, POST_QUALITIES, nextQuality, parseQuality } from './postSettings';

describe('post quality presets', () => {
  it('cycles low -> medium -> high -> low', () => {
    expect(nextQuality('low')).toBe('medium');
    expect(nextQuality('medium')).toBe('high');
    expect(nextQuality('high')).toBe('low');
  });

  it('parses known values and falls back otherwise', () => {
    expect(parseQuality('high', 'medium')).toBe('high');
    expect(parseQuality('ultra', 'medium')).toBe('medium');
    expect(parseQuality(null, 'low')).toBe('low');
  });

  it('only enables heavier passes as quality rises', () => {
    expect(POST_PRESETS.low.enabled).toBe(false);
    expect(POST_PRESETS.medium.ao).toBe(false);
    expect(POST_PRESETS.high.ao).toBe(true);
    for (const q of POST_QUALITIES) expect(POST_PRESETS[q].bloomStrength).toBeGreaterThanOrEqual(0);
  });
});
