import { FIXED_DT, LANE_CHANGE_DURATION_S } from './constants';
import type { PlayerState } from './contracts';

// Scaled sports-car bounds. The pivot sits at the visual centre and the
// calculated lift only compensates for the wider body while it rolls.
export const PLAYER_FLIP_PIVOT_Y_M = 0.674;
const PLAYER_FLIP_HALF_WIDTH_M = 1.076;
const PLAYER_FLIP_HALF_HEIGHT_M = 0.692;
export const PLAYER_FLIP_MAX_LIFT_M =
  Math.hypot(PLAYER_FLIP_HALF_WIDTH_M, PLAYER_FLIP_HALF_HEIGHT_M) -
  PLAYER_FLIP_HALF_HEIGHT_M;

export interface LaneChangeAnimationPose {
  readonly progress: number;
  readonly rollRad: number;
  readonly liftM: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Render-only flourish driven entirely by deterministic fixed-step state. */
export function laneChangeAnimationPose(
  player: Readonly<PlayerState>,
  interpolationAlpha: number,
): LaneChangeAnimationPose {
  let direction = player.laneChangeDirection;
  let currentProgress: number;
  let previousProgress: number;
  if (direction === 0) {
    const completedDirection = Math.sign(player.xM - player.previousXM);
    if (completedDirection === 0) {
      return { progress: 0, rollRad: 0, liftM: 0 };
    }
    direction = completedDirection as -1 | 1;
    currentProgress = 1;
    previousProgress = clamp01(1 - FIXED_DT / LANE_CHANGE_DURATION_S);
  } else {
    currentProgress = clamp01(
      player.laneChangeElapsedS / LANE_CHANGE_DURATION_S,
    );
    previousProgress = clamp01(
      (player.laneChangeElapsedS - FIXED_DT) / LANE_CHANGE_DURATION_S,
    );
  }
  const progress =
    previousProgress +
    (currentProgress - previousProgress) * clamp01(interpolationAlpha);
  const eased = progress * progress * (3 - 2 * progress);
  const rollRad = progress === 0 ? 0 : -direction * Math.PI * 2 * eased;
  const rotatedHalfHeightM =
    Math.abs(Math.sin(rollRad)) * PLAYER_FLIP_HALF_WIDTH_M +
    Math.abs(Math.cos(rollRad)) * PLAYER_FLIP_HALF_HEIGHT_M;
  return {
    progress,
    // Viewed from behind, right rolls clockwise and left rolls anticlockwise.
    rollRad,
    // Preserve the normal tyre contact plane without raising the whole jump.
    liftM: Math.max(0, rotatedHalfHeightM - PLAYER_FLIP_HALF_HEIGHT_M),
  };
}
