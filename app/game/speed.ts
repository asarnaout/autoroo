import {
  ACCELERATION_MPS2,
  MAX_SPEED_MPS,
  SPEED_RAMP_MPS2,
  SPEED_SCORE_STEP,
  SPEED_STEP_MPS,
  START_SPEED_MPS,
} from './constants';

/** Milestones use the displayed run score, including all earned bonuses. */
export function speedLimitForScore(score: number): number {
  const steps = Math.floor(Math.max(0, score) / SPEED_SCORE_STEP);
  return Math.min(MAX_SPEED_MPS, START_SPEED_MPS + steps * SPEED_STEP_MPS);
}

export function drivingAccelerationMps2(speedMps: number): number {
  return speedMps < START_SPEED_MPS ? ACCELERATION_MPS2 : SPEED_RAMP_MPS2;
}
