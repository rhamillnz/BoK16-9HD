import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { existsSync } from 'node:fs';
import {
  angleDelta,
  creatureModelName,
  headingTowards,
  modelHeight,
  namedModelName,
  partyModelName,
} from './fighterModels';

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
    expect(creatureModelName(39)).toBe('scp');
    expect(creatureModelName(42)).toBe('wyv');
    expect(creatureModelName(40)).toBeUndefined(); // no such monster
  });

  it('has a model file for every mapped creature', () => {
    for (let m = 0; m < 70; m++) {
      const name = creatureModelName(m);
      if (name) expect(existsSync(`public/models/creatures/${name}.glb`), name).toBe(true);
    }
  });

  it("reads a model's height from the rig's extras, else a person's", () => {
    const root = new THREE.Group();
    expect(modelHeight(root)).toBe(1.8);
    const rig = new THREE.Group();
    rig.userData.height = 3.2;
    root.add(rig);
    expect(modelHeight(root)).toBe(3.2);
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

describe('named character models', () => {
  it('maps the talking characters by dialogue actor, and every model file exists', () => {
    expect(namedModelName(14)).toBe('marc');
    expect(namedModelName(50)).toBe('delekhan');
    expect(namedModelName(43)).toBeUndefined();
    for (const actor of [14, 21, 25, 30, 40, 50, 52])
      expect(existsSync(`public/models/named/${namedModelName(actor)}.glb`)).toBe(true);
  });
});
