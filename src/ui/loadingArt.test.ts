import { describe, expect, it } from 'vitest';
import { FADE_SECONDS, SLIDE_SECONDS, TOWN_VIEWS, slideAt, slideOrder } from './loadingArt';

describe('loading slideshow', () => {
  it('lists the twelve town views', () => {
    expect(TOWN_VIEWS).toHaveLength(12);
  });

  it('shuffles every slide exactly once', () => {
    const order = slideOrder(12, () => 0.3);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('fades into the next slide and carries its zoom on without a jump', () => {
    const before = slideAt(SLIDE_SECONDS - 0.001, 5);
    const after = slideAt(SLIDE_SECONDS + 0.001, 5);
    expect(before.next).toBe(after.current);
    expect(before.fade).toBeCloseTo(1, 2);
    expect(after.fade).toBe(0);
    expect(after.zoom).toBeCloseTo(before.nextZoom, 3);
    expect(slideAt(SLIDE_SECONDS - FADE_SECONDS - 0.1, 5).fade).toBe(0);
  });
});
