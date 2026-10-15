import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { existsSync } from 'node:fs';
import { angleDelta, creatureModelName, headingTowards, partyModelName } from './fighterModels';

describe('party combat models', () => {
  it('maps party members to their model files', () => {
    expect(partyModelName('Locklear')).toBe('locklear');
    expect(partyModelName(' Patrus ')).toBe('patrus');
    expect(partyModelName('scorpion')).toBeUndefined();
  });

  it('maps monsters to creature models, sharing one model across a sprite set', () => {
    expect(creatureModelName(18)).toBe('mor');
    expect(creatureModelName(29)).toBe('gnt');
    expect(creatureModelName(33)).toBe('gnt');
    expect(creatureModelName(39)).toBeUndefined(); // scorpion: not built yet
  });

  it('has a model file for every mapped creature', () => {
    for (let m = 0; m < 70; m++) {
      const name = creatureModelName(m);
      if (name) expect(existsSync(`public/models/creatures/${name}.glb`), name).toBe(true);
    }
  });

  it('takes the short way round when turning', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });

  it('faces a model (forward +Z) towards a point', () => {
    const o = new THREE.Vector3(0, 0, 0);
    expect(headingTowards(o, new THREE.Vector3(0, 5, 2))).toBeCloseTo(0);
    expect(headingTowards(o, new THREE.Vector3(3, 0, 0))).toBeCloseTo(Math.PI / 2);
    expect(headingTowards(o, new THREE.Vector3(0, 1, 0))).toBeUndefined();
  });
});
