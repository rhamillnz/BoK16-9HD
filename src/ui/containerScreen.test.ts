import { describe, expect, it } from 'vitest';
import { ContainerScreen, WordLockScreen, type ContainerView, type WordLockView } from './containerScreen';
import type { HudHost } from './hudRegistry';
import type { WordLockState } from '../game/wordLock';

/** A HUD host whose close() closes the screen like HudScreens.close does. */
function rig() {
  const host = {
    width: 640,
    height: 360,
    party: [],
    closes: 0,
    screen: undefined as { close(): void } | undefined,
    close() {
      this.closes++;
      this.screen?.close();
    },
  };
  return host;
}
const containerView = (closed: string[]): ContainerView => ({
  title: 'Body',
  capacity: () => 2,
  items: () => [],
  message: () => '',
  onTake: () => {},
  onTakeAll: () => {},
  onPut: () => {},
  onClose: () => closed.push('close'),
});

describe('ContainerScreen', () => {
  it('is modal, so hotkeys cannot swap it out', () => {
    expect(new ContainerScreen(rig() as unknown as HudHost).modal).toBe(true);
  });
  it('reports onClose once on Escape', () => {
    const host = rig();
    const screen = new ContainerScreen(host as unknown as HudHost);
    host.screen = screen;
    const closed: string[] = [];
    screen.show(containerView(closed));
    screen.escape();
    screen.escape();
    expect(closed).toEqual(['close']);
    expect(host.closes).toBe(1);
    expect(screen.open()).toBe(false);
  });
  it('reports onClose when the HUD closes it some other way', () => {
    const screen = new ContainerScreen(rig() as unknown as HudHost);
    const closed: string[] = [];
    screen.show(containerView(closed));
    screen.close();
    screen.close();
    expect(closed).toEqual(['close']);
  });
});

describe('WordLockScreen', () => {
  it('counts a close without solving as leaving, once', () => {
    const screen = new WordLockScreen(rig() as unknown as HudHost);
    const left: string[] = [];
    const state = { position: [0, 0], puzzle: { hint: '', answer: 'ab', options: ['ab'] } } as unknown as WordLockState;
    const view: WordLockView = { state: () => state, onTurn: () => {}, onLeave: () => left.push('leave') };
    screen.show(view);
    screen.close();
    screen.close();
    expect(left).toEqual(['leave']);
  });
});
