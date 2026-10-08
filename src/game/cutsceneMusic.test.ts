import { describe, expect, it } from 'vitest';
import { cutsceneMusic } from './cutsceneControls';

function fake(songId: number | null) {
  const log: string[] = [];
  const m = {
    songId,
    play: async (n: number) => {
      log.push(`play ${n}`);
      m.songId = n;
    },
    stop: () => {
      log.push('stop');
      m.songId = null;
    },
  };
  return { m, log };
}

describe('cutsceneMusic', () => {
  it('plays the named song and restores the one before', () => {
    const { m, log } = fake(2);
    const c = cutsceneMusic(m);
    c.change(1003);
    c.change(1007);
    c.restore();
    expect(log).toEqual(['play 3', 'play 7', 'play 2']);
  });

  it('stops at the end when nothing played before', () => {
    const { m, log } = fake(null);
    const c = cutsceneMusic(m);
    c.change(1015);
    c.restore();
    expect(log).toEqual(['play 15', 'stop']);
  });

  it('ignores non-song indexes, restores nothing without a change, and works without a player', () => {
    const { m, log } = fake(2);
    const c = cutsceneMusic(m);
    c.change(300);
    c.restore();
    expect(log).toEqual([]);
    expect(() => {
      const n = cutsceneMusic(undefined);
      n.change(1003);
      n.restore();
    }).not.toThrow();
  });
});
