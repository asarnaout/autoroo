import { visualRoadProfileAt } from './generator';
import type { ModelKey } from './assets';

export type StreetlightSide = -1 | 1;

/**
 * Curbside Rush's NYC blue-hour palette, reduced for Autoroo's shorter draw
 * distance. The road stays readable under cool moonlight while warm practical
 * lights carry the city rather than flattening every building into a bright
 * wall.
 */
export const NIGHT_PALETTE = Object.freeze({
  skyTop: '#0e1a33',
  skyHorizon: '#293d61',
  fog: '#23344f',
  ground: '#34363b',
  pavement: '#45474c',
  // Lifted neutral asphalt keeps the dark-blue player car legible between
  // lamps and lets the additive sodium pools read as light on real tarmac.
  road: '#383d42',
  roadPaint: '#d8d7cd',
  lampWarm: '#ffd08a',
});

export const STREETLIGHT_SPACING_M = 26;
export const STREETLIGHT_POOL_SIZE = 14;
export const STREETLIGHT_RECYCLE_BEHIND_M = 52;
export const STREETLIGHT_VISIBLE_BEHIND_M = 48;
export const STREETLIGHT_VISIBLE_AHEAD_M = 306;
export const STREETLIGHT_CURB_OFFSET_M = 0.68;

export interface StreetlightPlacement {
  readonly absoluteStation: number;
  readonly poolSlot: number;
  readonly side: StreetlightSide;
  readonly zM: number;
  readonly xM: number;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function firstStreetlightStation(playerZM: number): number {
  return Math.floor(
    (playerZM - STREETLIGHT_RECYCLE_BEHIND_M) / STREETLIGHT_SPACING_M,
  );
}

export function streetlightPoolSlot(stationIndex: number): number {
  return positiveModulo(stationIndex, STREETLIGHT_POOL_SIZE);
}

/** Alternating kerbs make a lively avenue without doubling the lamp draw cost. */
export function streetlightSide(stationIndex: number): StreetlightSide {
  return positiveModulo(stationIndex, 2) === 0 ? -1 : 1;
}

export function streetlightPlacement(
  seed: number,
  stationIndex: number,
): StreetlightPlacement {
  const absoluteStation = Math.floor(stationIndex);
  const side = streetlightSide(absoluteStation);
  const zM = absoluteStation * STREETLIGHT_SPACING_M;
  const profile = visualRoadProfileAt(seed, zM);
  const roadEdgeM = profile.centerX + side * (profile.widthM / 2);
  return {
    absoluteStation,
    poolSlot: streetlightPoolSlot(absoluteStation),
    side,
    zM,
    xM: roadEdgeM + side * STREETLIGHT_CURB_OFFSET_M,
  };
}

export function isStreetlightVisible(
  lightZM: number,
  playerZM: number,
): boolean {
  const relativeZM = lightZM - playerZM;
  return (
    relativeZM > -STREETLIGHT_VISIBLE_BEHIND_M &&
    relativeZM < STREETLIGHT_VISIBLE_AHEAD_M
  );
}

/** Material-name aliases verified as actual panes in the curated NYC models. */
export function isNightWindowMaterialName(
  name: string,
  modelKey?: ModelKey,
): boolean {
  const lowerName = name.toLowerCase();
  // The midrise's lower panes are mislabelled as trim. Other models use trim
  // for actual frames, so the alias must stay scoped to this asset.
  return (
    /window|glass|cristal/.test(lowerName) ||
    (modelKey === 'midriseA' && lowerName === 'trim')
  );
}
