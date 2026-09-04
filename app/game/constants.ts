import type { LaneIndex, VehicleKind } from './contracts';

export const FIXED_DT = 1 / 60;
export const LANE_X = [-5.4, -1.8, 1.8, 5.4] as const;
export const TWO_LANES = 0b0110;
export const THREE_LEFT = 0b0111;
export const THREE_RIGHT = 0b1110;
export const FOUR_LANES = 0b1111;
export const MODULE_LENGTH_M = 100;
export const ROAD_TILE_LENGTH_M = 40;
export const ROAD_SIDEWALK_WIDTH_M = 1.15;
export const RENDER_POOL_LIMITS = Object.freeze({
  frontCars: 40,
  buses: 16,
  rearCars: 4,
  roadTiles: 16,
});

export const MAX_SPEED_MPS = 36;
export const ACCELERATION_MPS2 = 8;
export const BRAKING_MPS2 = 14;
export const COAST_DRAG_MPS2 = 0.35;
export const PLAYER_WIDTH_M = 1.9;
export const LATERAL_COLLISION_MARGIN_M = 0.1;
export const LANE_CHANGE_TICKS = 12;
export const LANE_CHANGE_DURATION_S = LANE_CHANGE_TICKS * FIXED_DT;
export const LANE_COMMAND_INTERVAL_TICKS = Math.ceil(0.1 / FIXED_DT);
export const JUMP_IMPULSE_MPS = 21;
export const GRAVITY_MPS2 = 50;
export const JUMP_FLIGHT_SECONDS = (2 * JUMP_IMPULSE_MPS) / GRAVITY_MPS2;
export const JUMP_APEX_M =
  (JUMP_IMPULSE_MPS * JUMP_IMPULSE_MPS) / (2 * GRAVITY_MPS2);

// The calm opening is deliberately short: by the first kilometre Autoroo is
// already close to its bounded, high-density traffic cap.
export const DIFFICULTY_DISTANCE_SCALE_M = 700;

export const PLAYER_LENGTH_M = 3.6;
export const LONGITUDINAL_MARGIN_M = 0.25;
export const VERTICAL_CLEARANCE_M = 0.15;
export const TIMING_MARGIN_TICKS = 2;
export const MIN_SPACE_WINDOW_S = 0.25;
export const GATE_APPROACH_CLEAR_M = 240;
export const GATE_LANDING_CLEAR_M = 70;
export const GATE_WITNESS_LIMIT_S = 20;
// This covers every built-in sedan/SUV gate trajectory, landing zone, and
// combined collider without coupling road topology to the selected attempt.
// Multi-row hop gauntlets can occupy a little over 80 m before their moving
// blockers and landing corridor are accounted for.
export const GATE_FORWARD_STEADY_M = 245;

export const VEHICLE_DIMENSIONS: Readonly<
  Record<VehicleKind, { lengthM: number; widthM: number; heightM: number }>
> = {
  sedan: { lengthM: 4, widthM: 1.8, heightM: 1.45 },
  suv: { lengthM: 4.2, widthM: 1.9, heightM: 1.62 },
  bus: { lengthM: 7, widthM: 2.2, heightM: 2.7 },
};

export const EMPTY_INPUT = Object.freeze({
  accelerate: false,
  brake: false,
  laneDelta: 0,
  jumpPressed: false,
} as const);

export function difficultyAt(distanceM: number): number {
  return 1 - Math.exp(-Math.max(0, distanceM) / DIFFICULTY_DISTANCE_SCALE_M);
}

export function hasLane(mask: number, lane: LaneIndex): boolean {
  return (mask & (1 << lane)) !== 0;
}

export function activeLanes(mask: number): LaneIndex[] {
  const result: LaneIndex[] = [];
  for (let lane = 0; lane < 4; lane += 1) {
    if ((mask & (1 << lane)) !== 0) result.push(lane as LaneIndex);
  }
  return result;
}

export function countLanes(mask: number): number {
  let count = 0;
  for (let lane = 0; lane < 4; lane += 1) count += (mask >> lane) & 1;
  return count;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
