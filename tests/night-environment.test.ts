import { describe, expect, it } from 'vitest';
import { ROAD_SIDEWALK_WIDTH_M } from '../app/game/constants';
import { visualRoadProfileAt } from '../app/game/generator';
import {
  NIGHT_PALETTE,
  STREETLIGHT_CURB_OFFSET_M,
  STREETLIGHT_POOL_SIZE,
  STREETLIGHT_SPACING_M,
  firstStreetlightStation,
  isNightWindowMaterialName,
  isStreetlightVisible,
  streetlightPlacement,
  streetlightPoolSlot,
} from '../app/game/nightEnvironment';

describe('night environment', () => {
  it('uses a cool blue-hour palette with warm practical lights', () => {
    expect(NIGHT_PALETTE).toMatchObject({
      skyTop: '#0e1a33',
      skyHorizon: '#293d61',
      fog: '#23344f',
      lampWarm: '#ffd08a',
    });
  });

  it('recycles a bounded alternating streetlight ring', () => {
    for (const playerZM of [0, 27.99, 28, 91_234.5]) {
      const first = firstStreetlightStation(playerZM);
      const stations = Array.from(
        { length: STREETLIGHT_POOL_SIZE },
        (_, offset) => first + offset,
      );
      expect(new Set(stations.map(streetlightPoolSlot)).size).toBe(
        STREETLIGHT_POOL_SIZE,
      );
      for (let index = 1; index < stations.length; index += 1) {
        const previous = streetlightPlacement(2026, stations[index - 1]);
        const current = streetlightPlacement(2026, stations[index]);
        expect(current.zM - previous.zM).toBe(STREETLIGHT_SPACING_M);
        expect(current.side).toBe(-previous.side);
      }
    }
  });

  it('keeps every pole just outside its local curved road edge', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      for (let station = -20; station < 220; station += 1) {
        const light = streetlightPlacement(seed, station);
        const profile = visualRoadProfileAt(seed, light.zM);
        const edge = profile.centerX + light.side * (profile.widthM / 2);
        expect(light.side * (light.xM - edge)).toBeCloseTo(
          STREETLIGHT_CURB_OFFSET_M,
          10,
        );
        expect(STREETLIGHT_CURB_OFFSET_M).toBeLessThan(ROAD_SIDEWALK_WIDTH_M);
      }
    }
  });

  it('recycles only one lamp after travelling one station', () => {
    const playerZM = 742.25;
    const beforeFirst = firstStreetlightStation(playerZM);
    const afterFirst = firstStreetlightStation(
      playerZM + STREETLIGHT_SPACING_M,
    );
    expect(afterFirst).toBe(beforeFirst + 1);
    const before = new Set(
      Array.from(
        { length: STREETLIGHT_POOL_SIZE },
        (_, offset) => beforeFirst + offset,
      ),
    );
    const retained = Array.from(
      { length: STREETLIGHT_POOL_SIZE },
      (_, offset) => afterFirst + offset,
    ).filter((station) => before.has(station));
    expect(retained).toHaveLength(STREETLIGHT_POOL_SIZE - 1);
  });

  it('uses bounded visibility and only verified glass aliases', () => {
    expect(isStreetlightVisible(-47.9, 0)).toBe(true);
    expect(isStreetlightVisible(-48, 0)).toBe(false);
    expect(isStreetlightVisible(305.9, 0)).toBe(true);
    expect(isStreetlightVisible(306, 0)).toBe(false);
    expect(isNightWindowMaterialName('citybits_texture_Glass')).toBe(true);
    expect(isNightWindowMaterialName('window')).toBe(true);
    expect(isNightWindowMaterialName('border')).toBe(false);
    expect(isNightWindowMaterialName('citybits_texture')).toBe(false);
  });
});
