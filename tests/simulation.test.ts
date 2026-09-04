import { describe, expect, it } from 'vitest';
import {
  ACCELERATION_MPS2,
  BRAKING_MPS2,
  COAST_DRAG_MPS2,
  FIXED_DT,
  GATE_FORWARD_STEADY_M,
  JUMP_APEX_M,
  JUMP_FLIGHT_SECONDS,
  LANE_CHANGE_DURATION_S,
  LANE_CHANGE_TICKS,
  LANE_X,
  MAX_SPEED_MPS,
  activeLanes,
  countLanes,
} from '../app/game/constants';
import type { InputFrame, PlayerState } from '../app/game/contracts';
import {
  nudgeGateToSteadyRoad,
  roadModuleAt,
  roadModuleForDistance,
  scheduledGateDistance,
} from '../app/game/generator';
import {
  AutorooSimulation,
  advancePlayerPhysics,
  certifyJumpGate,
  collidesSwept,
  computeGateWindow,
  createTrafficVehicle,
  runRenderSchedule,
  verifyJumpCertificate,
} from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

const idle: InputFrame = {
  accelerate: false,
  brake: false,
  laneDelta: 0,
  jumpPressed: false,
};
const accelerate: InputFrame = { ...idle, accelerate: true };

function player(patch: Partial<PlayerState> = {}): PlayerState {
  return {
    lane: 1,
    xM: LANE_X[1],
    previousXM: LANE_X[1],
    laneChangeStartXM: LANE_X[1],
    laneChangeElapsedS: 0,
    laneChangeDirection: 0,
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

function gateFor(seed: number, index = 0): number {
  const gateZM = nudgeGateToSteadyRoad(
    seed,
    scheduledGateDistance(seed, index),
  );
  if (gateZM === null) throw new Error(`No steady gate for seed ${seed}`);
  return gateZM;
}

function steadyFourLaneDistance(seed: number): number {
  for (let moduleIndex = 0; moduleIndex < 200; moduleIndex += 1) {
    const roadModule = roadModuleAt(seed, moduleIndex);
    if (
      roadModule.transition === null &&
      activeLanes(roadModule.fromLaneMask).length === 4
    ) {
      return roadModule.startM + 10;
    }
  }
  throw new Error(`No steady four-lane module for seed ${seed}`);
}

describe('road defaults', () => {
  it('starts seeded runs on an active lane of a three-lane road', () => {
    for (const seed of [0, 1, 44, 0xa770_2026]) {
      const snapshot = new AutorooSimulation(seed).snapshot();
      expect(snapshot.laneCount).toBe(3);
      expect(countLanes(snapshot.laneMask)).toBe(3);
      expect(activeLanes(snapshot.laneMask)).toContain(snapshot.player.lane);
    }
  });
});

describe('fixed-step vehicle physics', () => {
  it('applies acceleration, braking, and coasting at their declared rates', () => {
    const state = player({ speedMps: 10 });
    advancePlayerPhysics(state, accelerate);
    expect(state.speedMps).toBeCloseTo(10 + ACCELERATION_MPS2 * FIXED_DT, 10);
    advancePlayerPhysics(state, { ...idle, brake: true });
    expect(state.speedMps).toBeCloseTo(
      10 + (ACCELERATION_MPS2 - BRAKING_MPS2) * FIXED_DT,
      10,
    );
    const beforeCoast = state.speedMps;
    advancePlayerPhysics(state, idle);
    expect(state.speedMps).toBeCloseTo(
      beforeCoast - COAST_DRAG_MPS2 * FIXED_DT,
      10,
    );
  });

  it('caps acceleration at the declared higher top speed', () => {
    const state = player({ speedMps: MAX_SPEED_MPS - 0.01 });
    advancePlayerPhysics(state, accelerate);
    expect(state.speedMps).toBe(MAX_SPEED_MPS);
  });

  it('jumps in place at zero speed and lands after the fixed flight', () => {
    const state = player();
    advancePlayerPhysics(state, { ...idle, jumpPressed: true });
    let apex = state.yM;
    for (
      let tick = 1;
      tick <= Math.ceil(JUMP_FLIGHT_SECONDS / FIXED_DT) + 1;
      tick += 1
    ) {
      advancePlayerPhysics(state, idle);
      apex = Math.max(apex, state.yM);
    }
    expect(state.absoluteZM).toBe(0);
    expect(state.airborne).toBe(false);
    expect(state.yM).toBe(0);
    expect(apex).toBeCloseTo(JUMP_APEX_M, 2);
  });

  it('holds takeoff speed in air, making jump distance proportional to speed', () => {
    const state = player({ speedMps: 20 });
    advancePlayerPhysics(state, { ...idle, jumpPressed: true });
    const takeoffSpeed = state.takeoffSpeedMps;
    while (state.airborne)
      advancePlayerPhysics(state, { ...idle, brake: true });
    expect(state.absoluteZM).toBeGreaterThanOrEqual(
      takeoffSpeed * JUMP_FLIGHT_SECONDS,
    );
    expect(state.absoluteZM).toBeLessThanOrEqual(
      takeoffSpeed * (JUMP_FLIGHT_SECONDS + FIXED_DT),
    );
    expect(state.speedMps).toBeCloseTo(takeoffSpeed, 8);
  });

  it('takes off on the first fixed tick after landing while jump is held', () => {
    const state = player({ speedMps: 20 });
    const heldJump = { ...idle, jumpPressed: true };
    advancePlayerPhysics(state, heldJump);
    let flightTicks = 1;
    while (state.airborne) {
      advancePlayerPhysics(state, heldJump);
      flightTicks += 1;
    }
    expect(flightTicks).toBe(51);
    expect(state.yM).toBe(0);

    advancePlayerPhysics(state, heldJump);

    expect(state.airborne).toBe(true);
    expect(state.jumpElapsedS).toBe(FIXED_DT);
  });
});

describe('lane movement and collision/scoring rules', () => {
  it('animates between bounded lanes and allows airborne lane changes', () => {
    const simulation = new AutorooSimulation(12);
    simulation.start();
    simulation.tick({ ...idle, laneDelta: 1 });
    let playerState = simulation.snapshot().player;
    expect(playerState).toMatchObject({
      lane: 2,
      previousXM: LANE_X[1],
      laneChangeDirection: 1,
    });
    expect(playerState.xM).toBeGreaterThan(LANE_X[1]);
    expect(playerState.xM).toBeLessThan(LANE_X[2]);
    expect(simulation.drainEvents()).toEqual([{ type: 'lane-change' }]);

    for (let tick = 1; tick < LANE_CHANGE_TICKS; tick += 1)
      simulation.tick(idle);
    playerState = simulation.snapshot().player;
    expect(playerState).toMatchObject({
      lane: 2,
      xM: LANE_X[2],
      previousXM: expect.any(Number),
      laneChangeDirection: 0,
    });

    simulation.tick({ ...idle, laneDelta: 1 });
    expect(simulation.snapshot().player).toMatchObject({
      lane: 2,
      xM: LANE_X[2],
      laneChangeDirection: 0,
    });
    expect(simulation.drainEvents()).toEqual([]);
    simulation.tick({ ...idle, jumpPressed: true });
    simulation.drainEvents();
    simulation.tick({ ...idle, laneDelta: -1 });
    playerState = simulation.snapshot().player;
    expect(playerState).toMatchObject({
      lane: 1,
      airborne: true,
      laneChangeDirection: -1,
    });
    expect(playerState.xM).toBeGreaterThan(LANE_X[1]);
    expect(playerState.xM).toBeLessThan(LANE_X[2]);
    expect(simulation.drainEvents()).toEqual([{ type: 'lane-change' }]);
  });

  it('queues rapid lane flips one step at a time and allows cancelling the queue', () => {
    const simulation = new AutorooSimulation(12);
    simulation.start();
    const zM = steadyFourLaneDistance(12);
    simulation.__debugSetPlayer({
      lane: 0,
      absoluteZM: zM,
      previousZM: zM,
      maxForwardM: zM,
    });
    simulation.__debugReplaceTraffic([]);

    simulation.tick({ ...idle, laneDelta: 1 });
    simulation.tick({ ...idle, laneDelta: 1 });
    expect(simulation.snapshot().player).toMatchObject({
      lane: 1,
      queuedLane: 2,
      laneChangeDirection: 1,
    });
    simulation.tick({ ...idle, laneDelta: -1 });
    expect(simulation.snapshot().player.queuedLane).toBeNull();
    while (simulation.snapshot().player.laneChangeDirection !== 0)
      simulation.tick(idle);
    expect(simulation.snapshot().player).toMatchObject({
      lane: 1,
      xM: LANE_X[1],
    });

    simulation.drainEvents();
    simulation.tick({ ...idle, laneDelta: 1 });
    simulation.tick({ ...idle, laneDelta: 1 });
    for (let tick = 0; tick < LANE_CHANGE_TICKS * 2; tick += 1) {
      if (
        simulation.snapshot().player.lane === 3 &&
        simulation.snapshot().player.laneChangeDirection === 0
      )
        break;
      simulation.tick(idle);
    }
    expect(simulation.snapshot().player).toMatchObject({
      lane: 3,
      xM: LANE_X[3],
      queuedLane: null,
      laneChangeDirection: 0,
    });
    expect(simulation.drainEvents()).toEqual([
      { type: 'lane-change' },
      { type: 'lane-change' },
    ]);
  });

  it('uses swept collision so high-speed tunnelling still crashes', () => {
    const state = player({
      previousZM: 0,
      absoluteZM: 20,
      previousYM: 0,
      yM: 0,
    });
    const vehicle = createTrafficVehicle(
      'v',
      'e',
      'sedan',
      'ordinary',
      1,
      10,
      0,
    );
    vehicle.previousZM = 10;
    expect(collidesSwept(state, vehicle)).toBe(true);
    state.previousYM = 4;
    state.yM = 4;
    expect(collidesSwept(state, vehicle)).toBe(false);
    state.lane = 2;
    state.previousXM = LANE_X[2];
    state.xM = LANE_X[2];
    expect(collidesSwept(state, vehicle)).toBe(false);
  });

  it('catches a too-late lateral dodge through an occupied lane', () => {
    const late = player({
      lane: 2,
      previousXM: LANE_X[1],
      xM: LANE_X[2],
      previousZM: 0,
      absoluteZM: 10,
    });
    const vehicle = createTrafficVehicle(
      'late-dodge',
      'row',
      'sedan',
      'ordinary',
      1,
      5,
      0,
    );
    expect(collidesSwept(late, vehicle)).toBe(true);

    const early = player({
      lane: 2,
      previousXM: LANE_X[2],
      xM: LANE_X[2],
      previousZM: 0,
      absoluteZM: 10,
    });
    expect(collidesSwept(early, vehicle)).toBe(false);
  });

  it('lets an early lane flip clear a rear-end crash but rejects the same move too late', () => {
    function runDodge(laneChangeTick: number): AutorooSimulation {
      const simulation = new AutorooSimulation(18);
      simulation.start();
      simulation.__debugSetPlayer({ speedMps: 30 });
      simulation.__debugReplaceTraffic([
        createTrafficVehicle(
          'dodge-window',
          'dodge-window',
          'sedan',
          'ordinary',
          1,
          8,
          6,
        ),
      ]);
      for (let tick = 0; tick < 24; tick += 1) {
        simulation.tick({
          ...idle,
          laneDelta: tick === laneChangeTick ? 1 : 0,
        });
        if (simulation.snapshot().phase === 'game-over') break;
      }
      return simulation;
    }

    expect(runDodge(0).snapshot().phase).toBe('running');
    expect(runDodge(7).snapshot().phase).toBe('game-over');
  });

  it('ends the run on the first collision', () => {
    const simulation = new AutorooSimulation(22);
    simulation.start();
    simulation.__debugReplaceTraffic([
      createTrafficVehicle('bonk', 'bonk', 'sedan', 'ordinary', 1, 0, 0),
    ]);
    simulation.tick(idle);
    expect(simulation.snapshot().phase).toBe('game-over');
    const hash = simulation.stateHash();
    simulation.tick(accelerate);
    expect(simulation.stateHash()).toBe(hash);
  });

  it('awards a jump once and a grounded adjacent close pass once', () => {
    const jumpRun = new AutorooSimulation(32);
    jumpRun.start();
    jumpRun.__debugReplaceTraffic([
      createTrafficVehicle('jumped', 'row', 'sedan', 'ordinary', 1, 3, 0),
    ]);
    jumpRun.__debugSetPlayer({
      speedMps: 600,
      takeoffSpeedMps: 600,
      airborne: true,
      jumpElapsedS: 0.35,
      yM: 4,
      previousYM: 4,
    });
    jumpRun.tick(idle);
    const jumpBonus = jumpRun.snapshot().bonusScore;
    jumpRun.tick(idle);
    expect(jumpBonus).toBe(100);
    expect(jumpRun.snapshot().bonusScore).toBe(100);

    const closeRun = new AutorooSimulation(33);
    closeRun.start();
    closeRun.__debugReplaceTraffic([
      createTrafficVehicle('close', 'row', 'suv', 'ordinary', 2, 3, 0),
    ]);
    closeRun.__debugSetPlayer({ speedMps: 600 });
    closeRun.tick(idle);
    const closeBonus = closeRun.snapshot().bonusScore;
    closeRun.tick(idle);
    expect(closeBonus).toBe(25);
    expect(closeRun.snapshot().bonusScore).toBe(25);
  });

  it('awards +250 for a bus and scores maximum forward metres plus bonuses', () => {
    const simulation = new AutorooSimulation(34);
    simulation.start();
    simulation.__debugReplaceTraffic([
      createTrafficVehicle('bus-hop', 'row', 'bus', 'ordinary', 1, 3, 0),
    ]);
    simulation.__debugSetPlayer({
      speedMps: 600,
      takeoffSpeedMps: 600,
      airborne: true,
      jumpElapsedS: 0.35,
      yM: 4,
      previousYM: 4,
      maxForwardM: 123.9,
    });
    simulation.tick(idle);
    expect(simulation.snapshot()).toMatchObject({
      bonusScore: 250,
      score: 373,
    });
    simulation.tick(idle);
    expect(simulation.snapshot().bonusScore).toBe(250);
  });

  it('can narrowly clear an ordinary bus at maximum speed', () => {
    const window = computeGateWindow('bus', 8, MAX_SPEED_MPS);
    const simulation = new AutorooSimulation(341);
    simulation.start();
    simulation.__debugReplaceTraffic([
      createTrafficVehicle(
        'max-speed-bus',
        'max-speed-bus-row',
        'bus',
        'ordinary',
        1,
        (window.separationMinM + window.separationMaxM) / 2,
        8,
      ),
    ]);
    simulation.__debugSetPlayer({ speedMps: MAX_SPEED_MPS });
    simulation.tick({ ...idle, jumpPressed: true });
    for (
      let tick = 0;
      tick < 80 && simulation.snapshot().bonusScore === 0;
      tick += 1
    ) {
      simulation.tick(idle);
    }
    expect(simulation.snapshot()).toMatchObject({
      phase: 'running',
      bonusScore: 250,
    });
  });

  it('finalizes a pass bonus on a vehicle retirement-boundary tick', () => {
    const simulation = new AutorooSimulation(340);
    simulation.start();
    simulation.__debugReplaceTraffic([
      createTrafficVehicle(
        'retiring-hop',
        'retiring-row',
        'sedan',
        'ordinary',
        1,
        3,
        8,
        null,
        3.1,
      ),
    ]);
    simulation.__debugSetPlayer({
      absoluteZM: 6.9,
      previousZM: 6.9,
      maxForwardM: 6.9,
      speedMps: 30,
      takeoffSpeedMps: 30,
      airborne: true,
      jumpElapsedS: 0.35,
      yM: 4,
      previousYM: 4,
    });

    simulation.tick(idle);

    expect(simulation.phaseName).toBe('running');
    expect(simulation.renderTraffic).toHaveLength(0);
    expect(simulation.snapshot().bonusScore).toBe(100);
    expect(simulation.drainEvents()).toContainEqual({
      type: 'bonus',
      label: 'CAR HOP!',
      points: 100,
    });
  });

  it('canonicalizes simultaneous bonus events independent of traffic storage order', () => {
    const run = (reverse: boolean) => {
      const car = createTrafficVehicle(
        'a-car',
        'old-car',
        'sedan',
        'ordinary',
        1,
        0,
        0,
      );
      const bus = createTrafficVehicle(
        'b-bus',
        'old-bus',
        'bus',
        'ordinary',
        1,
        0,
        0,
      );
      car.airborneOverlap = true;
      bus.airborneOverlap = true;
      const simulation = new AutorooSimulation(341);
      simulation.start();
      simulation.__debugSetPlayer({
        absoluteZM: 100,
        previousZM: 100,
        maxForwardM: 100,
      });
      simulation.__debugReplaceTraffic(reverse ? [bus, car] : [car, bus]);
      simulation.tick(idle);
      const result = {
        stateHash: simulation.stateHash(),
        snapshot: simulation.snapshot(),
        events: simulation.drainEvents(),
      };
      return result;
    };
    const ordered = run(false);
    const reversed = run(true);
    expect(reversed).toEqual(ordered);
    expect(ordered.snapshot.bonusScore).toBe(350);
    expect(ordered.snapshot.lastBonusLabel).toBe('BUS BOUNCE! +250');
  });

  it('does not make crash-tick bonuses depend on traffic array order', () => {
    const run = (reverse: boolean) => {
      const cleared = createTrafficVehicle(
        'cleared',
        'old',
        'sedan',
        'ordinary',
        1,
        -10,
        0,
      );
      cleared.airborneOverlap = true;
      const crash = createTrafficVehicle(
        'crash',
        'now',
        'sedan',
        'ordinary',
        1,
        0,
        0,
      );
      const simulation = new AutorooSimulation(35);
      simulation.start();
      simulation.__debugReplaceTraffic(
        reverse ? [crash, cleared] : [cleared, crash],
      );
      simulation.tick(idle);
      return {
        phase: simulation.snapshot().phase,
        bonus: simulation.snapshot().bonusScore,
        events: simulation.drainEvents(),
      };
    };
    expect(run(false)).toEqual(run(true));
    expect(run(false)).toMatchObject({ phase: 'game-over', bonus: 0 });
  });
});

describe('winnability certificates', () => {
  it('keeps the compact arc human-tolerant for gates and just bus-clearable at full speed', () => {
    const car = computeGateWindow('sedan', 4, 28);
    const suv = computeGateWindow('suv', 3, 28);
    const bus = computeGateWindow('bus', 8, MAX_SPEED_MPS);
    expect(JUMP_APEX_M).toBeCloseTo(4.41, 2);
    expect(JUMP_FLIGHT_SECONDS).toBeCloseTo(0.84, 3);
    expect(car.minimumSpeedMps).toBeCloseTo(26.89, 1);
    expect(suv.minimumSpeedMps).toBeCloseTo(27.91, 1);
    expect(car.inputWindowS).toBeGreaterThanOrEqual(0.25);
    expect(suv.inputWindowS).toBeGreaterThanOrEqual(0.25);
    expect(car.feasible && suv.feasible).toBe(true);
    expect(bus.inputWindowS).toBeGreaterThan(0);
    expect(bus.inputWindowS).toBeLessThan(0.06);
    expect(bus.feasible).toBe(false);
  });

  it('certifies exact reveal states with stable dependency and witness hashes', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      const gateZM = gateFor(seed);
      const request = {
        seed,
        tick: 400,
        player: player({
          absoluteZM: gateZM - 200,
          previousZM: gateZM - 200,
          maxForwardM: gateZM - 200,
        }),
        gateZM,
        kind: 'sedan' as const,
        blockerSpeedMps: 4,
        targetSpeedMps: 28,
      };
      const first = certifyJumpGate(request);
      const second = certifyJumpGate(request);
      expect(first).not.toBeNull();
      expect(second?.dependencyHash).toBe(first?.dependencyHash);
      expect(second?.witnessTraceHash).toBe(first?.witnessTraceHash);
      expect(
        first!.safeTakeoffTickMax - first!.safeTakeoffTickMin,
      ).toBeGreaterThanOrEqual(15);
      expect(first!.inputWindowS).toBeGreaterThanOrEqual(0.25);
      expect(first!.minimumSpeedMps).toBeLessThanOrEqual(28);
      expect(
        first!.witness.at(-1)!.tick - first!.revealTick,
      ).toBeLessThanOrEqual(1200);
    }
  }, 30_000);

  it('certifies and binds an exact mid-flip reveal state', () => {
    const seed = 17;
    const gateZM = gateFor(seed);
    const revealZM = gateZM - 200;
    const revealPlayer = player({
      lane: 2,
      xM: (LANE_X[1] + LANE_X[2]) / 2,
      previousXM: (LANE_X[1] + LANE_X[2]) / 2 - 0.2,
      laneChangeStartXM: LANE_X[1],
      laneChangeElapsedS: LANE_CHANGE_DURATION_S / 2,
      laneChangeDirection: 1,
      absoluteZM: revealZM,
      previousZM: revealZM,
      maxForwardM: revealZM,
    });
    const request = {
      seed,
      tick: 400,
      player: revealPlayer,
      gateZM,
      kind: 'sedan' as const,
      blockerSpeedMps: 4,
      targetSpeedMps: 28,
    };
    const certificate = certifyJumpGate(request);
    expect(certificate).not.toBeNull();
    expect(verifyJumpCertificate(request, certificate!)).toBe(true);
    expect(
      verifyJumpCertificate(
        {
          ...request,
          player: { ...revealPlayer, xM: revealPlayer.xM + 0.001 },
        },
        certificate!,
      ),
    ).toBe(false);
  });

  it('rejects a gate when live ordinary traffic contaminates its reveal corridor', () => {
    const seed = 19;
    const gateZM = gateFor(seed);
    const revealPlayer = player({
      absoluteZM: gateZM - 200,
      previousZM: gateZM - 200,
      speedMps: 20,
      maxForwardM: gateZM - 200,
    });
    const conflict = createTrafficVehicle(
      'live-conflict',
      'live-row',
      'sedan',
      'ordinary',
      1,
      revealPlayer.absoluteZM + 4,
      8,
    );
    expect(
      certifyJumpGate({
        seed,
        tick: 400,
        player: revealPlayer,
        traffic: [conflict],
        gateZM,
        kind: 'sedan',
        blockerSpeedMps: 4,
        targetSpeedMps: 28,
      }),
    ).toBeNull();
  });

  it('binds all live traffic state independent of input array order', () => {
    const seed = 29;
    const gateZM = gateFor(seed);
    const revealPlayer = player({
      absoluteZM: gateZM - 200,
      previousZM: gateZM - 200,
      maxForwardM: gateZM - 200,
    });
    const first = createTrafficVehicle(
      'a',
      'far',
      'sedan',
      'ordinary',
      1,
      gateZM + 600,
      8,
    );
    const second = createTrafficVehicle(
      'b',
      'far',
      'suv',
      'ordinary',
      2,
      gateZM + 620,
      9,
    );
    const request = {
      seed,
      tick: 700,
      player: revealPlayer,
      traffic: [first, second],
      gateZM,
      kind: 'sedan' as const,
      blockerSpeedMps: 4,
      targetSpeedMps: 28,
    };
    const original = certifyJumpGate(request);
    const reordered = certifyJumpGate({ ...request, traffic: [second, first] });
    expect(original).not.toBeNull();
    expect(reordered?.dependencyHash).toBe(original?.dependencyHash);

    const changedKind = createTrafficVehicle(
      'a',
      'far',
      'bus',
      'ordinary',
      1,
      gateZM + 600,
      8,
    );
    const changedPrevious = { ...first, previousZM: first.previousZM - 0.001 };
    expect(
      certifyJumpGate({ ...request, traffic: [changedKind, second] })
        ?.dependencyHash,
    ).not.toBe(original?.dependencyHash);
    expect(
      certifyJumpGate({ ...request, traffic: [changedPrevious, second] })
        ?.dependencyHash,
    ).not.toBe(original?.dependencyHash);
  });

  it('deep-freezes and independently verifies the whole advertised takeoff window', () => {
    const seed = 39;
    const gateZM = gateFor(seed);
    const request = {
      seed,
      tick: 900,
      player: player({
        absoluteZM: gateZM - 200,
        previousZM: gateZM - 200,
        maxForwardM: gateZM - 200,
      }),
      gateZM,
      kind: 'suv' as const,
      blockerSpeedMps: 3,
      targetSpeedMps: 28,
    };
    const certificate = certifyJumpGate(request);
    expect(certificate).not.toBeNull();
    expect(Object.isFrozen(certificate)).toBe(true);
    expect(Object.isFrozen(certificate!.blockerTrajectories)).toBe(true);
    expect(Object.isFrozen(certificate!.witness[0].input)).toBe(true);
    expect(certificate!.verticalClearanceM).toBeGreaterThanOrEqual(0.15);
    expect(certificate!.longitudinalMarginM).toBe(0.25);
    expect(verifyJumpCertificate(request, certificate!)).toBe(true);

    const tampered = structuredClone(certificate!);
    (tampered.witness[0].input as { brake: boolean }).brake =
      !tampered.witness[0].input.brake;
    expect(verifyJumpCertificate(request, tampered)).toBe(false);

    const forgedPatches: readonly Record<string, unknown>[] = [
      { version: 2 },
      { id: 'forged-certificate' },
      { gateSeed: certificate!.gateSeed + 1 },
      { blockerIds: ['forged-blocker'] },
      { minimumSpeedMps: 0 },
      { targetSpeedMps: 0 },
      { timingMarginTicks: 0 },
      { verticalClearanceM: 0.15 },
      {
        safeTakeoffTickMin: certificate!.safeTakeoffTickMin + 1,
        safeTakeoffTickMax: certificate!.safeTakeoffTickMax - 1,
        inputWindowS:
          (certificate!.safeTakeoffTickMax -
            certificate!.safeTakeoffTickMin -
            2) *
          FIXED_DT,
      },
    ];
    for (const patch of forgedPatches) {
      const forged = Object.assign(structuredClone(certificate!), patch);
      expect(verifyJumpCertificate(request, forged)).toBe(false);
    }
  }, 30_000);

  it('attaches replayed, immutable ground-route proofs to every ordinary row', () => {
    const simulation = new AutorooSimulation(41);
    simulation.start();
    for (
      let tick = 0;
      tick < 600 && simulation.getGroundCertificates().length === 0;
      tick += 1
    ) {
      simulation.tick(accelerate);
    }
    const certificates = simulation.getGroundCertificates();
    expect(certificates.length).toBeGreaterThan(0);
    let previousLane = certificates[0].targetLane;
    for (const certificate of certificates) {
      expect(certificate.kind).toBe('ground');
      expect(certificate.witness.length).toBeGreaterThan(0);
      expect(Object.isFrozen(certificate)).toBe(true);
      expect(
        Math.abs(certificate.targetLane - previousLane),
      ).toBeLessThanOrEqual(1);
      const blockers = simulation.renderTraffic.filter(
        (vehicle) => vehicle.certificateId === certificate.id,
      );
      expect(blockers.map((vehicle) => vehicle.id).sort()).toEqual(
        [...certificate.blockerIds].sort(),
      );
      expect(
        blockers.some((vehicle) => vehicle.lane === certificate.targetLane),
      ).toBe(false);
      previousLane = certificate.targetLane;
    }
  });

  it('falls back to clear road after an invalid four-candidate gate without stalling', () => {
    const seed = 42;
    const transition = Array.from({ length: 20 }, (_, index) =>
      roadModuleAt(seed, index),
    ).find((module) => module.transition);
    expect(transition).toBeDefined();
    const invalidGateZM = transition!.startM + 60;
    const simulation = new AutorooSimulation(seed);
    simulation.start();
    simulation.__debugReplaceTraffic([]);
    simulation.__debugSetPlayer({
      absoluteZM: invalidGateZM - 205,
      previousZM: invalidGateZM - 205,
      speedMps: 30,
      maxForwardM: invalidGateZM - 205,
    });
    simulation.__debugSetGateState({
      gateIndex: 0,
      pendingGateZM: invalidGateZM,
      pendingGateAttempted: false,
      lastGateZM: 0,
      activeCertificate: null,
    });
    simulation.tick(accelerate);
    expect(simulation.debugGateState()).toMatchObject({
      pendingGateZM: invalidGateZM,
      pendingGateAttempted: true,
      activeCertificate: null,
    });
    expect(
      simulation.renderTraffic.some((vehicle) => vehicle.role === 'gate'),
    ).toBe(false);

    simulation.__debugReplaceTraffic([]);
    simulation.__debugSetPlayer({
      absoluteZM: invalidGateZM + 71,
      previousZM: invalidGateZM + 71,
      speedMps: 30,
      maxForwardM: invalidGateZM + 71,
    });
    simulation.tick(accelerate);
    const next = simulation.debugGateState();
    expect(next.pendingGateAttempted).toBe(false);
    expect(next.pendingGateZM).toBeGreaterThanOrEqual(invalidGateZM + 500);
  });

  it('advances generation from the exact end of a failed gate reservation', () => {
    const gateZM = 5000;
    const simulation = new AutorooSimulation(7);
    simulation.start();
    simulation.__debugReplaceTraffic([]);
    simulation.__debugSetPlayer({
      absoluteZM: gateZM - 20,
      previousZM: gateZM - 20,
      speedMps: 0,
      maxForwardM: gateZM - 20,
    });
    simulation.__debugSetGateState({
      gateIndex: 5,
      pendingGateZM: gateZM,
      pendingGateAttempted: true,
      lastGateZM: 4000,
      activeCertificate: null,
    });
    (simulation as unknown as { encounterCursorM: number }).encounterCursorM =
      gateZM + GATE_FORWARD_STEADY_M;

    simulation.tick(idle);

    expect(simulation.renderTick).toBe(1);
    expect(simulation.phaseName).toBe('running');
  });

  it('lets a certificate-following bot pass traffic, a gate, and every road width', () => {
    const simulation = new AutorooSimulation(0xa770);
    simulation.start();
    let sawGate = false;
    let clearedGate = false;
    let widestRoad = simulation.snapshot().laneCount;
    let gateId: string | null = null;

    for (let step = 0; step < 15_000; step += 1) {
      const snapshot = simulation.snapshot();
      widestRoad = Math.max(widestRoad, snapshot.laneCount);
      const certificate = snapshot.activeCertificate;
      let input: InputFrame = accelerate;
      if (certificate) {
        sawGate = true;
        gateId = certificate.id;
        const localTick = snapshot.tick - certificate.revealTick;
        let laneDelta: -1 | 0 | 1 = 0;
        if (
          localTick >= 45 &&
          localTick % 6 === 0 &&
          snapshot.player.lane !== certificate.targetLane
        ) {
          laneDelta = snapshot.player.lane < certificate.targetLane ? 1 : -1;
        }
        input = {
          accelerate: localTick >= 45,
          brake: false,
          laneDelta,
          jumpPressed:
            snapshot.tick ===
            Math.floor(
              (certificate.safeTakeoffTickMin +
                certificate.safeTakeoffTickMax) /
                2,
            ),
        };
      } else {
        if (gateId) clearedGate = true;
        const ahead = simulation.renderTraffic
          .filter(
            (vehicle) =>
              vehicle.role === 'ordinary' &&
              vehicle.absoluteZM > snapshot.player.absoluteZM &&
              vehicle.absoluteZM - snapshot.player.absoluteZM < 90,
          )
          .sort((first, second) => first.absoluteZM - second.absoluteZM);
        if (ahead.length > 0) {
          const rowZ = ahead[0].absoluteZM;
          const blocked = new Set(
            ahead
              .filter((vehicle) => Math.abs(vehicle.absoluteZM - rowZ) < 10)
              .map((vehicle) => vehicle.lane),
          );
          if (blocked.has(snapshot.player.lane)) {
            const escape = activeLanes(snapshot.laneMask).find(
              (lane) =>
                !blocked.has(lane) &&
                Math.abs(lane - snapshot.player.lane) <= 1 &&
                !snapshot.traffic.some(
                  (vehicle) =>
                    vehicle.lane === lane &&
                    Math.abs(vehicle.absoluteZM - snapshot.player.absoluteZM) <
                      15,
                ),
            );
            if (escape !== undefined) {
              input = {
                ...accelerate,
                laneDelta: escape > snapshot.player.lane ? 1 : -1,
              };
            }
          }
        }
      }
      simulation.tick(input);
      expect(
        simulation.phaseName,
        JSON.stringify({
          step,
          z: snapshot.player.absoluteZM,
          lane: snapshot.player.lane,
          input,
          certificate: certificate?.id ?? null,
          nearby: snapshot.traffic
            .filter(
              (vehicle) =>
                Math.abs(vehicle.absoluteZM - snapshot.player.absoluteZM) < 20,
            )
            .map((vehicle) => ({
              id: vehicle.id,
              role: vehicle.role,
              lane: vehicle.lane,
              z: vehicle.absoluteZM,
            })),
        }),
      ).toBe('running');
      if (clearedGate && simulation.renderPlayer.absoluteZM > 2100) break;
    }

    expect(sawGate).toBe(true);
    expect(clearedGate).toBe(true);
    expect(widestRoad).toBe(4);
    expect(simulation.renderPlayer.absoluteZM).toBeGreaterThan(2000);
  }, 30_000);
});

describe('rear pressure and deterministic render timing', () => {
  it('warns, spawns no more than four pursuers, and retires them after recovery', () => {
    const simulation = new AutorooSimulation(44);
    simulation.start();
    simulation.__debugReplaceTraffic([]);
    for (let tick = 0; tick < 490; tick += 1) simulation.tick(idle);
    let snapshot = simulation.snapshot();
    expect(snapshot.rearWarning).toBe(true);
    const rearPressure = snapshot.traffic.filter(
      (vehicle) => vehicle.role === 'rear-pressure',
    );
    expect(rearPressure).toHaveLength(snapshot.laneCount);
    expect(
      rearPressure
        .map((vehicle) => vehicle.lane)
        .sort((first, second) => first - second),
    ).toEqual(activeLanes(snapshot.laneMask));
    for (
      let tick = 0;
      tick < 180 && simulation.phaseName === 'running';
      tick += 1
    ) {
      simulation.tick(accelerate);
      const running = simulation.snapshot();
      for (const vehicle of running.traffic.filter(
        (candidate) => candidate.role === 'rear-pressure',
      )) {
        expect(vehicle.speedMps - running.player.speedMps).toBeLessThanOrEqual(
          6 + 1e-9,
        );
      }
    }
    snapshot = simulation.snapshot();
    expect(snapshot.phase).toBe('running');
    expect(
      snapshot.traffic.filter((vehicle) => vehicle.role === 'rear-pressure'),
    ).toHaveLength(0);
  });

  it('gives tapers a bounded rear-pack grace and rear traffic can cause a real collision', () => {
    const transitionRun = new AutorooSimulation(45);
    transitionRun.start();
    const transition = Array.from({ length: 20 }, (_, index) =>
      roadModuleAt(45, index),
    ).find((module) => module.transition);
    expect(transition).toBeDefined();
    transitionRun.__debugSetPlayer({
      absoluteZM: transition!.startM + 10,
      previousZM: transition!.startM + 10,
      maxForwardM: transition!.startM + 10,
    });
    transitionRun.__debugReplaceTraffic([]);
    transitionRun.__debugSetRearState({
      slowTimeS: 8,
      rearPackActive: false,
    });
    transitionRun.tick(idle);
    expect(
      transitionRun
        .snapshot()
        .traffic.filter((vehicle) => vehicle.role === 'rear-pressure'),
    ).toHaveLength(0);
    for (let tick = 0; tick < 180; tick += 1) transitionRun.tick(idle);
    expect(
      transitionRun
        .snapshot()
        .traffic.filter((vehicle) => vehicle.role === 'rear-pressure').length,
    ).toBeGreaterThan(0);

    const collisionRun = new AutorooSimulation(46);
    collisionRun.start();
    collisionRun.__debugReplaceTraffic([
      createTrafficVehicle(
        'rear-hit',
        'rear',
        'sedan',
        'rear-pressure',
        1,
        -4.2,
        6,
      ),
    ]);
    for (
      let tick = 0;
      tick < 10 && collisionRun.phaseName === 'running';
      tick += 1
    ) {
      collisionRun.tick(idle);
    }
    expect(collisionRun.snapshot().phase).toBe('game-over');
    expect(collisionRun.snapshot().bonusScore).toBe(0);
  });

  it('never deletes already-revealed traffic as it approaches a taper', () => {
    const seed = 48;
    const transition = Array.from({ length: 20 }, (_, index) =>
      roadModuleAt(seed, index),
    ).find((module) => module.transition);
    expect(transition).toBeDefined();
    const simulation = new AutorooSimulation(seed);
    simulation.start();
    simulation.__debugSetPlayer({
      absoluteZM: transition!.startM - 50,
      previousZM: transition!.startM - 50,
      maxForwardM: transition!.startM - 50,
    });
    simulation.__debugReplaceTraffic([
      createTrafficVehicle(
        'taper-bound',
        'taper-row',
        'sedan',
        'ordinary',
        1,
        transition!.startM - 0.01,
        8,
      ),
    ]);
    simulation.tick(idle);
    expect(
      simulation.renderTraffic.some((vehicle) => vehicle.id === 'taper-bound'),
    ).toBe(true);
  });

  it('retires certified ordinary trajectories before obstacle-free tapers', () => {
    const simulation = new AutorooSimulation(0);
    simulation.start();
    for (let tick = 0; tick < 5000; tick += 1) {
      const snapshot = simulation.snapshot();
      const nearest = snapshot.traffic
        .filter(
          (vehicle) =>
            vehicle.role === 'ordinary' &&
            vehicle.absoluteZM >= snapshot.player.absoluteZM,
        )
        .sort((first, second) => first.absoluteZM - second.absoluteZM)[0];
      const route = nearest
        ? simulation
            .getGroundCertificates()
            .find((certificate) => certificate.blockerIds.includes(nearest.id))
        : undefined;
      let laneDelta: -1 | 0 | 1 = 0;
      if (route && snapshot.player.lane !== route.targetLane) {
        laneDelta = snapshot.player.lane < route.targetLane ? 1 : -1;
      }
      simulation.__debugSetRearState({ slowTimeS: 0, recoveryTimeS: 0 });
      simulation.tick({
        accelerate: snapshot.player.speedMps < 8.2,
        brake: snapshot.player.speedMps > 8.3,
        laneDelta,
        jumpPressed: false,
      });
      expect(simulation.phaseName).toBe('running');
      for (const vehicle of simulation.renderTraffic) {
        if (vehicle.role !== 'ordinary') continue;
        expect(vehicle.retireAtZM).not.toBeNull();
        const roadModule = roadModuleForDistance(0, vehicle.absoluteZM);
        const insideTaper =
          roadModule.transition !== null &&
          vehicle.absoluteZM >= roadModule.transition.warningEndM;
        expect(insideTaper).toBe(false);
      }
    }
  });

  it('caps the undrained event queue', () => {
    const simulation = new AutorooSimulation(47);
    simulation.start();
    for (let tick = 0; tick < 7000; tick += 1) {
      simulation.__debugReplaceTraffic([]);
      simulation.__debugSetRearState({ slowTimeS: 0, recoveryTimeS: 0 });
      simulation.tick({ ...accelerate, jumpPressed: tick % 90 === 0 });
    }
    expect(simulation.debugRetainedCounts().pendingEvents).toBe(64);
    expect(simulation.drainEvents()).toHaveLength(64);
    expect(simulation.drainEvents()).toEqual([]);
  });

  it('includes pending observable events in the exact state hash', () => {
    const simulation = new AutorooSimulation(49);
    simulation.start();
    simulation.tick({ ...idle, jumpPressed: true });
    const withJumpEvent = simulation.stateHash();
    expect(simulation.drainEvents()).toContainEqual({ type: 'jump' });
    expect(simulation.stateHash()).not.toBe(withJumpEvent);
  });

  it('produces identical hashes under 30/60/120/144 Hz and jitter', () => {
    const totalTicks = 6000;
    const totalSeconds = totalTicks * FIXED_DT;
    const source = new AutorooSimulation(55);
    source.start();
    const trace: InputFrame[] = [];
    const laneCounts = new Set<number>();
    let sawRear = false;
    let sawGate = false;
    for (let tick = 0; tick < totalTicks; tick += 1) {
      const snapshot = source.snapshot();
      const input = tick < 490 ? idle : certificateBotInput(source, snapshot);
      trace.push({ ...input });
      source.tick(input);
      const after = source.snapshot();
      laneCounts.add(after.laneCount);
      sawRear ||= after.traffic.some(
        (vehicle) => vehicle.role === 'rear-pressure',
      );
      sawGate ||= after.activeCertificate !== null;
      expect(after.phase).toBe('running');
    }
    expect(sawRear).toBe(true);
    expect(sawGate).toBe(true);
    expect(laneCounts).toEqual(new Set([2, 3, 4]));

    const schedule = (hz: number) =>
      Array.from({ length: Math.round(totalSeconds * hz) }, () => 1 / hz);
    const jitter: number[] = [];
    let jitterTotal = 0;
    for (let index = 0; jitterTotal < totalSeconds - 1e-12; index += 1) {
      const duration = index % 2 === 0 ? 1 / 50 : 1 / 75;
      const next = Math.min(duration, totalSeconds - jitterTotal);
      jitter.push(next);
      jitterTotal += next;
    }
    jitter[jitter.length - 1] += totalSeconds - jitterTotal + 1e-10;
    const run = (frames: number[]) => {
      const simulation = new AutorooSimulation(55);
      simulation.start();
      const hash = runRenderSchedule(
        simulation,
        frames,
        (tick) => trace[tick] ?? idle,
      );
      expect(simulation.renderTick).toBe(totalTicks);
      return hash;
    };
    const reference = source.stateHash();
    expect(run(schedule(60))).toBe(reference);
    expect(run(schedule(30))).toBe(reference);
    expect(run(schedule(120))).toBe(reference);
    expect(run(schedule(144))).toBe(reference);
    expect(run(jitter)).toBe(reference);
  });

  it('hashes exact future-determining physics and rear state without traffic-order noise', () => {
    const first = new AutorooSimulation(56);
    const second = new AutorooSimulation(56);
    first.__debugSetPlayer({ speedMps: 1 });
    second.__debugSetPlayer({ speedMps: 1.0004 });
    expect(first.stateHash()).not.toBe(second.stateHash());

    const sedan = createTrafficVehicle(
      'same',
      'row',
      'sedan',
      'ordinary',
      1,
      50,
      8,
    );
    const suv = createTrafficVehicle(
      'same',
      'row',
      'suv',
      'ordinary',
      1,
      50,
      8,
    );
    first.__debugReplaceTraffic([sedan]);
    second.__debugReplaceTraffic([suv]);
    expect(first.stateHash()).not.toBe(second.stateHash());

    const ordered = new AutorooSimulation(57);
    const reversed = new AutorooSimulation(57);
    const a = createTrafficVehicle('a', 'row', 'sedan', 'ordinary', 1, 50, 8);
    const b = createTrafficVehicle('b', 'row', 'suv', 'ordinary', 2, 60, 8);
    ordered.__debugReplaceTraffic([a, b]);
    reversed.__debugReplaceTraffic([b, a]);
    expect(ordered.stateHash()).toBe(reversed.stateHash());
    reversed.__debugSetRearState({ slowTimeS: FIXED_DT });
    expect(ordered.stateHash()).not.toBe(reversed.stateHash());
  });
});
