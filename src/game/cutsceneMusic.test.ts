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
    // Sound 1000 + N is in file N + 1 (songs.ts).
    expect(log).toEqual(['play 4', 'play 8', 'play 2']);
  });

  it('stops at the end when nothing played before', () => {
    const { m, log } = fake(null);
    const c = cutsceneMusic(m);
    c.change(1015);
    c.restore();
    expect(log).toEqual(['play 16', 'stop']);
  });

  it('goes back to the exploring rotation when it was playing', () => {
    const { m, log } = fake(6);
    const r = Object.assign(m, {
      rotating: true,
      resumeRotation: async () => {
        log.push('rotation');
      },
    });
    const c = cutsceneMusic(r);
    c.change(1003);
    c.restore();
    expect(log).toEqual(['play 4', 'rotation']);
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
