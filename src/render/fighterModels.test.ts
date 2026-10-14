import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { angleDelta, headingTowards, partyModelName } from './fighterModels';

describe('party combat models', () => {
  it('maps party members to their model files', () => {
    expect(partyModelName('Locklear')).toBe('locklear');
    expect(partyModelName(' Patrus ')).toBe('patrus');
    expect(partyModelName('scorpion')).toBeUndefined();
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
