import type { ModelKey } from './assets';
import { visualRoadProfileAt } from './generator';
import { hashUnit } from './random';

export type RoadSide = -1 | 1;

export const BUILDING_KEYS = [
  'towerA',
  'towerB',
  'midriseA',
  'midriseLow',
  'brownstoneA',
  'shop',
] as const satisfies readonly ModelKey[];

export type BuildingModelKey = (typeof BUILDING_KEYS)[number];

interface BuildingLayout {
  /** Width of the facade after applying Autoroo's model scale. */
  readonly frontageM: number;
  /** Distance from the facade to the back wall after scaling. */
  readonly depthM: number;
  /** Direction of the authored facade before MODEL_CONFIGS yaw is applied. */
  readonly localFacadeHeading: number;
}

/** Measurements inherited from Curbside Rush's calibrated NYC street wall. */
export const BUILDING_LAYOUTS: Readonly<
  Record<BuildingModelKey, BuildingLayout>
> = {
  towerA: { frontageM: 16, depthM: 15.62, localFacadeHeading: Math.PI },
  towerB: { frontageM: 14, depthM: 14.42, localFacadeHeading: Math.PI },
  midriseA: { frontageM: 9, depthM: 8.42, localFacadeHeading: Math.PI },
  midriseLow: { frontageM: 6, depthM: 3.62, localFacadeHeading: Math.PI },
  brownstoneA: { frontageM: 11, depthM: 11, localFacadeHeading: 0 },
  shop: { frontageM: 8, depthM: 8, localFacadeHeading: 0 },
};

// This sequence keeps each 12 m lot from overlapping its neighbours while
// still reading as a continuous street wall. The opposite side starts halfway
// through it so the avenue does not look mirrored.
const BUILDING_PATTERN: readonly BuildingModelKey[] = [
  'towerA',
  'shop',
  'brownstoneA',
  'midriseA',
  'midriseLow',
  'brownstoneA',
  'midriseA',
  'shop',
  'towerB',
  'midriseLow',
  'brownstoneA',
  'midriseA',
  'midriseLow',
  'brownstoneA',
  'midriseA',
  'midriseLow',
];

export const BUILDING_STATION_SPACING_M = 12;
export const BUILDING_STATION_POOL_SIZE = 32;
export const BUILDING_POOL_SIZE = BUILDING_STATION_POOL_SIZE * 2;
export const SCENERY_RECYCLE_BEHIND_M = 64;
export const SCENERY_VISIBLE_BEHIND_M = 58;
export const SCENERY_VISIBLE_AHEAD_M = 305;
export const BUILDING_SIDEWALK_MIN_M = 1.35;
export const BUILDING_SIDEWALK_JITTER_M = 0.2;

export interface RoadsideBuildingPlacement {
  readonly absoluteStation: number;
  readonly poolSlot: number;
  readonly side: RoadSide;
  readonly modelKey: BuildingModelKey;
  readonly zM: number;
  readonly xM: number;
  /** The model root already owns its asset-specific MODEL_CONFIGS yaw. */
  readonly holderYaw: number;
  readonly sidewalkClearanceM: number;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function firstRoadsideBuildingStation(playerZM: number): number {
  return Math.floor(
    (playerZM - SCENERY_RECYCLE_BEHIND_M) / BUILDING_STATION_SPACING_M,
  );
}

export function roadsideBuildingPoolSlot(
  stationIndex: number,
  side: RoadSide,
): number {
  const stationSlot = positiveModulo(stationIndex, BUILDING_STATION_POOL_SIZE);
  return stationSlot * 2 + (side > 0 ? 1 : 0);
}

export function roadsideBuildingModelKey(
  stationIndex: number,
  side: RoadSide,
): BuildingModelKey {
  const oppositeSideOffset = side > 0 ? BUILDING_PATTERN.length / 2 : 0;
  return BUILDING_PATTERN[
    positiveModulo(stationIndex + oppositeSideOffset, BUILDING_PATTERN.length)
  ];
}

/** A quarter turn aims a facade inward at a road whose direction is +Z. */
export function roadFacingHolderYaw(side: RoadSide): number {
  return side * (Math.PI / 2);
}

function roadEdgeEnvelopeM(
  seed: number,
  centerZM: number,
  frontageM: number,
  side: RoadSide,
): number {
  const halfFrontageM = frontageM / 2;
  const sampleZM = [
    centerZM - halfFrontageM,
    centerZM,
    centerZM + halfFrontageM,
  ];
  let envelope = side < 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (const zM of sampleZM) {
    const profile = visualRoadProfileAt(seed, zM);
    const edgeM = profile.centerX + side * (profile.widthM / 2);
    envelope = side < 0 ? Math.min(envelope, edgeM) : Math.max(envelope, edgeM);
  }
  return envelope;
}

export function roadsideBuildingPlacement(
  seed: number,
  stationIndex: number,
  side: RoadSide,
): RoadsideBuildingPlacement {
  const absoluteStation = Math.floor(stationIndex);
  const modelKey = roadsideBuildingModelKey(absoluteStation, side);
  const layout = BUILDING_LAYOUTS[modelKey];
  const zM = absoluteStation * BUILDING_STATION_SPACING_M;
  const roadEdgeM = roadEdgeEnvelopeM(seed, zM, layout.frontageM, side);
  const sidewalkClearanceM =
    BUILDING_SIDEWALK_MIN_M +
    hashUnit(seed, absoluteStation, side < 0 ? 881 : 883) *
      BUILDING_SIDEWALK_JITTER_M;
  return {
    absoluteStation,
    poolSlot: roadsideBuildingPoolSlot(absoluteStation, side),
    side,
    modelKey,
    zM,
    xM: roadEdgeM + side * (sidewalkClearanceM + layout.depthM / 2),
    holderYaw: roadFacingHolderYaw(side),
    sidewalkClearanceM,
  };
}

export function isRoadsideBuildingVisible(
  buildingZM: number,
  playerZM: number,
): boolean {
  const relativeZM = buildingZM - playerZM;
  return (
    relativeZM > -SCENERY_VISIBLE_BEHIND_M &&
    relativeZM < SCENERY_VISIBLE_AHEAD_M
  );
}
