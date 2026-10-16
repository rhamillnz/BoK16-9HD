import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FLIGHT, RELEASE, SpellFx, spellColor } from './spellFx';

describe('spell effects', () => {
  it('fire spells glow orange, heals green', () => {
    expect(spellColor('damage', 'Flamecast')).toBe(0xff7a24);
    expect(spellColor('damage', 'Despair Thy Eyes')).not.toBe(0xff7a24);
    expect(spellColor('heal', 'Mind Melding')).toBe(0x5dff7a);
  });

  it('an orb waits for the release, lands on the target and then everything clears', () => {
    const fx = new SpellFx();
    const from = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(4, 0, 0);
    fx.gather(from, 0xffffff);
    fx.bolt(from, to, 0xffffff);
    expect(fx.active).toBe(3); // the gathering glow, the orb and its burst
    const orb = fx.group.children[1]!;
    fx.tick(RELEASE / 2);
    expect(orb.visible).toBe(false);
    fx.tick(RELEASE / 2 + FLIGHT - 0.001);
    expect(orb.position.x).toBeCloseTo(4, 1);
    for (let i = 0; i < 20; i++) fx.tick(0.1);
    expect(fx.active).toBe(0);
    expect(fx.group.children).toHaveLength(0);
    fx.dispose();
  });
});
