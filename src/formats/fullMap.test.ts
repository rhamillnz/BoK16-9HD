import { describe, expect, it } from 'vitest';
import { fitText, generateZoneNames, parseFMapTowns, parseFMapXY, zoneButtonLines } from './fullMap';

// Helper functions for building test data
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const nullTerminated = (s: string) => [...ascii(s), 0];

describe('parseFMapTowns', () => {
  it('parses towns from FMAP_TWN.DAT', () => {
    const data = new Uint8Array([
      // Map bounds
      ...u16(0),
      ...u16(100),
      ...u16(0),
      ...u16(100),
      ...u16(0),
      // Town 1: Krondor at (50, 50)
      ...u16(1), // type
      ...nullTerminated('Krondor'),
      ...u16(50),
      ...u16(50),
      // Town 2: Sar-Sargoth at (60, 60)
      ...u16(2), // type
      ...nullTerminated('Sar-Sargoth'),
      ...u16(60),
      ...u16(60),
      // Repeat empty towns to reach 33 total
      ...[...Array(31)].flatMap(() => [...u16(0), ...nullTerminated(''), ...u16(0), ...u16(0)]),
    ]);

    const towns = parseFMapTowns(data);
    expect(towns).toHaveLength(33);
    expect(towns[0]).toEqual({ name: 'Krondor', type: 1, x: 50, y: 50 });
    expect(towns[1]).toEqual({ name: 'Sar-Sargoth', type: 2, x: 60, y: 60 });
  });
});

describe('parseFMapXY', () => {
  it('parses zone tiles from FMAP_XY.DAT', () => {
    const data = new Uint8Array([
      // Zone 1: 2 tiles
      ...u16(2),
      ...u16(10),
      ...u16(20),
      ...u16(11),
      ...u16(21),
      // Zone 2: 1 tile
      ...u16(1),
      ...u16(30),
      ...u16(40),
      // Zones 3-12: 0 tiles each
      ...[...Array(10)].flatMap(() => [...u16(0)]),
    ]);

    const zones = parseFMapXY(data);
    expect(zones).toHaveLength(12);
    expect(zones[0]).toEqual({
      zone: 1,
      tiles: [
        { x: 10, y: 20 },
        { x: 11, y: 21 },
      ],
    });
    expect(zones[1]).toEqual({ zone: 2, tiles: [{ x: 30, y: 40 }] });
  });
});

describe('generateZoneNames', () => {
  it('names zones after towns within their bounds', () => {
    const towns = [
      { name: 'Krondor', type: 1, x: 50, y: 50 },
      { name: 'Sar-Sargoth', type: 2, x: 60, y: 60 },
      { name: 'Northwarden', type: 3, x: 100, y: 100 },
    ];

    const zones = [
      {
        zone: 1,
        tiles: [
          { x: 40, y: 40 },
          { x: 60, y: 60 },
        ],
      },
      {
        zone: 2,
        tiles: [
          { x: 90, y: 90 },
          { x: 110, y: 110 },
        ],
      },
      ...[...Array(10)].map((_, i) => ({ zone: i + 3, tiles: [] })),
    ];

    const names = generateZoneNames(towns, zones);
    expect(names[0]).toContain('Krondor');
    expect(names[0]).toContain('Sar-Sargoth');
    expect(names[1]).toContain('Northwarden');
  });

  it('uses nearest towns if none are inside', () => {
    const towns = [{ name: 'Krondor', type: 1, x: 0, y: 0 }];
    const zones = [
      { zone: 1, tiles: [{ x: 100, y: 100 }] },
      ...[...Array(11)].map((_, i) => ({ zone: i + 2, tiles: [] })),
    ];

    const names = generateZoneNames(towns, zones);
    expect(names[0]).toContain('Krondor');
  });

  it('labels underground zones as Mine if no towns', () => {
    const towns = [{ name: 'Krondor', type: 1, x: 0, y: 0 }];
    const zones = [
      ...[...Array(9)].map((_, i) => ({ zone: i + 1, tiles: [{ x: i, y: i }] })),
      { zone: 10, tiles: [] },
      { zone: 11, tiles: [] },
      { zone: 12, tiles: [] },
    ];

    const names = generateZoneNames(towns, zones);
    expect(names[9]).toBe('Mine 1');
    expect(names[10]).toBe('Mine 2');
    expect(names[11]).toBe('Mine 3');
  });
});

describe('zone buttons', () => {
  it('names a zone by its first town and says which zone it is', () => {
    expect(zoneButtonLines(1, "Loriel / Hawk's Hollow")).toEqual(['Loriel', 'Zone 1']);
    expect(zoneButtonLines(9, 'Timirianya')).toEqual(['Timirianya', 'Zone 9']);
  });
  it('labels the underground zones as mines', () => {
    expect(zoneButtonLines(11, 'Sarth / Krondor mines')).toEqual(['Mines', 'Mine 2']);
  });
  it('fits text by measured width with a full stop', () => {
    const measure = (s: string) => s.length * 10;
    expect(fitText('Loriel', 100, measure)).toBe('Loriel');
    expect(fitText('Highcastle', 60, measure)).toBe('Highc.');
  });
});
