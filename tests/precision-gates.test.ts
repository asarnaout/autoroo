import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  GATE_APPROACH_CLEAR_M,
  GATE_SEQUENCE_FORWARD_M,
  GATE_LANDING_CLEAR_M,
  LANE_X,
  LONGITUDINAL_MARGIN_M,
  BASE_SPEED_MPS,
  START_SPEED_MPS,
  SPEED_STEP_MPS,
  PLAYER_LENGTH_M,
  VEHICLE_DIMENSIONS,
  activeLanes,
} from '../app/game/constants';
import type {
  ChallengeCertificate,
  InputFrame,
  LaneIndex,
  PlayerState,
} from '../app/game/contracts';
import { isSteadyRoadRange, laneMaskAt } from '../app/game/generator';
import {
  AutorooSimulation,
  certifyJumpGate,
  createTrafficVehicle,
  mixedPressureManeuvers,
  type GateCertificationRequest,
} from '../app/game/simulation';

const SEED = 0xa770_2026;
const SHIFT_TICKS = Math.round(0.2 / FIXED_DT);

interface Fixture {
  request: GateCertificationRequest;
  certificate: ChallengeCertificate;
  firstJumpTick: number;
  jumpTicks: readonly number[];
  laneCommands: ReadonlyMap<number, InputFrame['laneDelta']>;
}

function steadyGateWithLanes(laneCount: number): number {
  for (let zM = 500; zM < 5000; zM += 10) {
    if (
      activeLanes(laneMaskAt(SEED, zM)).length === laneCount &&
      isSteadyRoadRange(
        SEED,
        zM - GATE_APPROACH_CLEAR_M,
        zM + GATE_SEQUENCE_FORWARD_M,
      )
    )
      return zM;
  }
  throw new Error(`No ${laneCount}-lane gate location`);
}

function makeFixture(
  gateZM: number,
  lane: LaneIndex,
  revealM: number,
  speedMps = BASE_SPEED_MPS,
): Fixture {
  const xM = LANE_X[lane];
  const player: PlayerState = {
    lane,
    xM,
    previousXM: xM,
    laneChangeStartXM: xM,
    laneChangeElapsedS: 0,
    laneChangeDirection: 0,
    queuedLane: null,
    absoluteZM: gateZM - revealM,
    previousZM: gateZM - revealM,
    yM: 0,
    previousYM: 0,
    speedMps,
    verticalSpeedMps: 0,
    airborne: false,
    takeoffSpeedMps: 0,
    jumpElapsedS: 0,
    maxForwardM: gateZM - revealM,
  };
  const request: GateCertificationRequest = {
    seed: SEED,
    bonusScore: Math.max(
      0,
      Math.round((speedMps - START_SPEED_MPS) / SPEED_STEP_MPS) * 5000 -
        Math.floor(player.maxForwardM),
    ),
    player,
    gateZM,
    kind: 'bus',
    blockerSpeedMps: 0,
    targetSpeedMps: speedMps,
    maneuverPlan: mixedPressureManeuvers(
      SEED,
      0,
      laneMaskAt(SEED, gateZM),
      lane,
      7,
      0,
      1,
      speedMps,
    ),
  };
  const certificate = certifyJumpGate(request);
  if (!certificate)
    throw new Error(`Gate rejected: ${lane}/${revealM}/${gateZM}`);
  const firstJumpTick = Math.floor(
    (certificate.safeTakeoffTickMin + certificate.safeTakeoffTickMax) / 2,
  );
  const jumpTicks = certificate.witness
    .filter((point) => point.input.jumpPressed)
    .map((point) => point.tick);
  return {
    request,
    certificate,
    firstJumpTick,
    jumpTicks,
    laneCommands: new Map(
      certificate.witness
        .filter((point) => point.input.laneDelta !== 0)
        .map((point) => [point.tick, point.input.laneDelta]),
    ),
  };
}

interface Perturbation {
  steerShiftTicks?: number;
  firstJumpShiftTicks?: number;
  secondJumpShiftTicks?: number;
  holdJump?: boolean;
}

/** Replay the certified obstacles through the same tick/collision path as play. */
function survives(fixture: Fixture, change: Perturbation = {}): boolean {
  const { request, certificate } = fixture;
  const simulation = new AutorooSimulation(SEED);
  simulation.start();
  simulation.__debugSetPlayer(request.player);
  simulation.__debugSetBonusScore(request.bonusScore ?? 0);
  simulation.__debugSetGateState({
    pendingGateZM: request.gateZM,
    pendingGateAttempted: true,
    activeCertificate: certificate,
  });
  simulation.__debugReplaceTraffic(
    certificate.blockerTrajectories.map((row) =>
      createTrafficVehicle(
        row.id,
        row.encounterId,
        'bus',
        'gate',
        row.lane,
        row.startZM,
        row.speedMps,
        certificate.id,
      ),
    ),
  );
  const endM =
    Math.max(...certificate.blockerTrajectories.map((row) => row.startZM)) +
    PLAYER_LENGTH_M / 2 +
    VEHICLE_DIMENSIONS.bus.lengthM / 2 +
    LONGITUDINAL_MARGIN_M +
    GATE_LANDING_CLEAR_M;
  const jumpTicks = new Set(
    fixture.jumpTicks.map(
      (tick, index) =>
        tick +
        (index === 0
          ? (change.firstJumpShiftTicks ?? 0)
          : index === 1
            ? (change.secondJumpShiftTicks ?? 0)
            : 0),
    ),
  );

  for (let step = 0; step < 1200; step += 1) {
    // This is an obstacle/input regression: keep the injected gate intact while
    // excluding unrelated future traffic and pickups from the isolated replay.
    simulation.__debugReplaceTraffic(
      simulation.renderTraffic.filter(
        (vehicle) => vehicle.certificateId === certificate.id,
      ),
    );
    simulation.__debugReplacePickups([]);
    const tick = simulation.renderTick;
    simulation.tick({
      laneDelta:
        fixture.laneCommands.get(tick - (change.steerShiftTicks ?? 0)) ?? 0,
      jumpPressed: change.holdJump
        ? tick >= fixture.firstJumpTick + (change.firstJumpShiftTicks ?? 0)
        : jumpTicks.has(tick),
    });
    simulation.drainEvents();
    if (simulation.phaseName === 'game-over') return false;
    if (
      simulation.renderPlayer.absoluteZM > endM &&
      !simulation.renderPlayer.airborne
    )
      return true;
  }
  throw new Error('Gate replay did not reach a collision or final landing');
}

describe('physical timing of precision bus challenges', () => {
  it('can be cleared across road widths, starting lanes, and input phases', () => {
    for (const laneCount of [2, 3, 4]) {
      const gateZM = steadyGateWithLanes(laneCount);
      for (const lane of activeLanes(laneMaskAt(SEED, gateZM))) {
        for (const revealM of [200, 213]) {
          const fixture = makeFixture(gateZM, lane, revealM);
          expect(
            fixture.certificate.maneuverPlan.map((row) => row.action),
          ).toEqual([
            'jump',
            'dodge',
            'dodge',
            'jump',
            'dodge',
            'dodge',
            'jump',
          ]);
          expect(survives(fixture), `lane ${lane}, reveal ${revealM}`).toBe(
            true,
          );
          // Each subsequent press must be represented in the saved witness,
          // including presses between its ordinary six-tick trace samples.
          expect(fixture.jumpTicks).toHaveLength(3);
        }
      }
    }
  }, 20_000);

  it.each([32.4, 36, 39.6, 43.2, 46.8, 50.4, 54])(
    'keeps mixed challenges solvable and precisely timed at %s m/s',
    (speedMps) => {
      for (const laneCount of [2, 3, 4]) {
        const gateZM = steadyGateWithLanes(laneCount);
        const lane = activeLanes(laneMaskAt(SEED, gateZM))[0];
        const fixture = makeFixture(gateZM, lane, 213, speedMps);
        expect(survives(fixture)).toBe(true);
        expect(survives(fixture, { holdJump: true })).toBe(false);
        for (const shift of [-SHIFT_TICKS, SHIFT_TICKS]) {
          expect(survives(fixture, { firstJumpShiftTicks: shift })).toBe(false);
          expect(survives(fixture, { secondJumpShiftTicks: shift })).toBe(
            false,
          );
          expect(survives(fixture, { steerShiftTicks: shift })).toBe(false);
        }
      }
    },
    20_000,
  );

  it('punishes independently mistimed jumps and lane changes', () => {
    const gateZM = steadyGateWithLanes(4);
    for (const lane of activeLanes(laneMaskAt(SEED, gateZM))) {
      const fixture = makeFixture(gateZM, lane, 213);
      expect(survives(fixture)).toBe(true);
      for (const shift of [-SHIFT_TICKS, SHIFT_TICKS]) {
        expect(survives(fixture, { firstJumpShiftTicks: shift })).toBe(false);
        // The opening jump remains correct, so it cannot conceal a generous
        // timing window on the next mandatory jump.
        expect(survives(fixture, { secondJumpShiftTicks: shift })).toBe(false);
        expect(survives(fixture, { steerShiftTicks: shift })).toBe(false);
      }
    }
  }, 20_000);

  it('has a physically narrow jump window and no winning held-jump phase', () => {
    const gateZM = steadyGateWithLanes(4);
    const fixture = makeFixture(gateZM, 1, 200);
    const successfulFirstPresses: number[] = [];
    for (let shift = -20; shift <= 20; shift += 1) {
      if (survives(fixture, { firstJumpShiftTicks: shift })) {
        successfulFirstPresses.push(shift);
      }
      expect(
        survives(fixture, {
          holdJump: true,
          firstJumpShiftTicks: shift,
        }),
        `held Jump beginning at offset ${shift}`,
      ).toBe(false);
    }
    expect(successfulFirstPresses).toContain(0);
    expect(successfulFirstPresses.length).toBeGreaterThanOrEqual(7);
    const physicalWindowS =
      (successfulFirstPresses.at(-1)! - successfulFirstPresses[0]) * FIXED_DT;
    // This sweeps actual collision outcomes, rather than trusting the shorter
    // window advertised by the generation certificate.
    expect(physicalWindowS).toBeLessThanOrEqual(0.2);
  }, 20_000);
});
