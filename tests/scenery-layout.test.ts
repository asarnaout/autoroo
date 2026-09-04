import { describe, expect, it } from 'vitest';
import { MODEL_CONFIGS } from '../app/game/assets';
import { visualRoadProfileAt } from '../app/game/generator';
import {
  BUILDING_KEYS,
  BUILDING_LAYOUTS,
  BUILDING_POOL_SIZE,
  BUILDING_SIDEWALK_MIN_M,
  BUILDING_STATION_POOL_SIZE,
  BUILDING_STATION_SPACING_M,
  firstRoadsideBuildingStation,
  isRoadsideBuildingVisible,
  roadFacingHolderYaw,
  roadsideBuildingPlacement,
  type RoadSide,
} from '../app/game/sceneryLayout';

const SIDES = [-1, 1] as const satisfies readonly RoadSide[];

function visiblePlan(seed: number, playerZM: number) {
  const firstStation = firstRoadsideBuildingStation(playerZM);
  return Array.from(
    { length: BUILDING_STATION_POOL_SIZE },
    (_, offset) => firstStation + offset,
  ).flatMap((station) =>
    SIDES.map((side) => roadsideBuildingPlacement(seed, station, side)),
  );
}

describe('pooled roadside building layout', () => {
  it('aims every calibrated facade inward toward the road', () => {
    expect(MODEL_CONFIGS.shop.yaw).toBe(Math.PI);
    for (const side of SIDES) {
      expect(roadFacingHolderYaw(side)).toBe(side * (Math.PI / 2));
      for (const key of BUILDING_KEYS) {
        const facadeHeading =
          roadFacingHolderYaw(side) +
          MODEL_CONFIGS[key].yaw +
          BUILDING_LAYOUTS[key].localFacadeHeading;
        // A left-side facade points +X; a right-side facade points -X.
        expect(Math.sin(facadeHeading)).toBeCloseTo(-side, 10);
        expect(Math.cos(facadeHeading)).toBeCloseTo(0, 10);
      }
    }
  });

  it('fills both sides with a fixed, deterministic 64-building ring', () => {
    for (const playerZM of [0, 11.99, 12, 837.4, 1_000_000_000]) {
      const plan = visiblePlan(0xa770_2026, playerZM);
      expect(plan).toEqual(visiblePlan(0xa770_2026, playerZM));
      expect(plan).toHaveLength(BUILDING_POOL_SIZE);
      expect(new Set(plan.map((entry) => entry.poolSlot)).size).toBe(
        BUILDING_POOL_SIZE,
      );
      expect(
        new Set(plan.map((entry) => `${entry.absoluteStation}:${entry.side}`))
          .size,
      ).toBe(BUILDING_POOL_SIZE);

      const stations = new Map<number, RoadSide[]>();
      for (const entry of plan) {
        const sides = stations.get(entry.absoluteStation) ?? [];
        sides.push(entry.side);
        stations.set(entry.absoluteStation, sides);
      }
      expect(stations.size).toBe(BUILDING_STATION_POOL_SIZE);
      for (const sides of stations.values())
        expect(sides.sort((left, right) => left - right)).toEqual([-1, 1]);

      const visibleCount = plan.filter((entry) =>
        isRoadsideBuildingVisible(entry.zM, playerZM),
      ).length;
      expect(visibleCount).toBeLessThanOrEqual(62);
    }
  });

  it('keeps facades beyond the widest curved road edge they overlap', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (let station = 0; station < 700; station += 1) {
        for (const side of SIDES) {
          const placement = roadsideBuildingPlacement(seed, station, side);
          const layout = BUILDING_LAYOUTS[placement.modelKey];
          const innerFacadeM = placement.xM - side * (layout.depthM / 2);
          for (const offsetM of [
            -layout.frontageM / 2,
            0,
            layout.frontageM / 2,
          ]) {
            const profile = visualRoadProfileAt(seed, placement.zM + offsetM);
            const roadEdgeM = profile.centerX + side * (profile.widthM / 2);
            expect(side * (innerFacadeM - roadEdgeM)).toBeGreaterThanOrEqual(
              BUILDING_SIDEWALK_MIN_M - 1e-9,
            );
          }
        }
      }
    }
  });

  it('packs neighbouring facades closely without overlapping them', () => {
    for (const side of SIDES) {
      for (let station = -64; station < 64; station += 1) {
        const current = roadsideBuildingPlacement(77, station, side);
        const next = roadsideBuildingPlacement(77, station + 1, side);
        const occupiedM =
          (BUILDING_LAYOUTS[current.modelKey].frontageM +
            BUILDING_LAYOUTS[next.modelKey].frontageM) /
          2;
        const gapM = BUILDING_STATION_SPACING_M - occupiedM;
        expect(gapM).toBeGreaterThanOrEqual(0);
        expect(gapM).toBeLessThanOrEqual(4.5);
      }
    }
  });

  it('recycles only one left/right station pair after travelling 12 m', () => {
    const before = visiblePlan(90210, 211.5);
    const after = visiblePlan(90210, 211.5 + BUILDING_STATION_SPACING_M);
    const beforeById = new Map(
      before.map((entry) => [`${entry.absoluteStation}:${entry.side}`, entry]),
    );
    const retained = after.filter((entry) =>
      beforeById.has(`${entry.absoluteStation}:${entry.side}`),
    );
    expect(retained).toHaveLength(BUILDING_POOL_SIZE - 2);
    for (const entry of retained) {
      expect(entry).toEqual(
        beforeById.get(`${entry.absoluteStation}:${entry.side}`),
      );
    }
  });
});
