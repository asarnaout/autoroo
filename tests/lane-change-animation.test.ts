import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  LANE_CHANGE_DURATION_S,
  LANE_X,
} from '../app/game/constants';
import type { PlayerState } from '../app/game/contracts';
import {
  PLAYER_FLIP_MAX_LIFT_M,
  laneChangeAnimationPose,
} from '../app/game/laneChangeAnimation';

function player(patch: Partial<PlayerState> = {}): PlayerState {
  return {
    lane: 2,
    xM: 0,
    previousXM: 0,
    laneChangeStartXM: LANE_X[1],
    laneChangeElapsedS: LANE_CHANGE_DURATION_S / 2,
    laneChangeDirection: 1,
    queuedLane: null,
    absoluteZM: 0,
    previousZM: 0,
    yM: 0,
    previousYM: 0,
    speedMps: 0,
    verticalSpeedMps: 0,
    airborne: false,
    takeoffSpeedMps: 0,
    jumpElapsedS: 0,
    maxForwardM: 0,
    ...patch,
  };
}

describe('goofy lane-change animation', () => {
  it('rolls right clockwise and left anticlockwise', () => {
    const right = laneChangeAnimationPose(player(), 1);
    const left = laneChangeAnimationPose(
      player({ laneChangeDirection: -1 }),
      1,
    );
    expect(right.progress).toBeCloseTo(0.5, 10);
    expect(right.rollRad).toBeCloseTo(-Math.PI, 10);
    expect(left.rollRad).toBeCloseTo(Math.PI, 10);
    expect(right.liftM).toBeCloseTo(0, 10);

    let maximumLiftM = 0;
    for (let tick = 1; tick <= 100; tick += 1) {
      maximumLiftM = Math.max(
        maximumLiftM,
        laneChangeAnimationPose(
          player({
            laneChangeElapsedS: (tick / 100) * LANE_CHANGE_DURATION_S,
          }),
          1,
        ).liftM,
      );
    }
    expect(maximumLiftM).toBeCloseTo(PLAYER_FLIP_MAX_LIFT_M, 3);
  });

  it('interpolates from rest on the first fixed lane-change tick', () => {
    const state = player({ laneChangeElapsedS: FIXED_DT });
    expect(laneChangeAnimationPose(state, 0)).toEqual({
      progress: 0,
      rollRad: 0,
      liftM: 0,
    });
    expect(laneChangeAnimationPose(state, 1).progress).toBeGreaterThan(0);
  });

  it('composes identically while grounded or airborne', () => {
    const grounded = laneChangeAnimationPose(player(), 0.4);
    const airborne = laneChangeAnimationPose(
      player({ airborne: true, yM: 3, previousYM: 2.8 }),
      0.4,
    );
    expect(airborne).toEqual(grounded);
  });

  it('returns to a neutral pose once the lane change lands', () => {
    expect(
      laneChangeAnimationPose(
        player({
          xM: LANE_X[2],
          previousXM: LANE_X[2],
          laneChangeElapsedS: 0,
          laneChangeDirection: 0,
        }),
        1,
      ),
    ).toEqual({ progress: 0, rollRad: 0, liftM: 0 });
  });
});
