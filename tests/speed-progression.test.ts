import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED_MPS,
  EMPTY_INPUT,
  FIXED_DT,
  MAX_SPEED_MPS,
  SPEED_RAMP_MPS2,
  START_SPEED_MPS,
} from '../app/game/constants';
import { makeBoosterState, ROCKET_DURATION_S } from '../app/game/boosters';
import {
  AutorooSimulation,
  createTrafficVehicle,
} from '../app/game/simulation';
import { speedLimitForScore } from '../app/game/speed';

function clearRun(): AutorooSimulation {
  const run = new AutorooSimulation(7);
  run.start();
  run.__debugSetGateState({
    pendingGateZM: Infinity,
    pendingGateAttempted: true,
  });
  return run;
}

function clearTick(run: AutorooSimulation, jump = false, tap = false): void {
  run.__debugReplaceTraffic([]);
  run.__debugReplacePickups([]);
  run.tick({ ...EMPTY_INPUT, jumpPressed: jump, jumpTapped: tap });
}

describe('score-based driving speed', () => {
  it('starts moving at 90% and ramps at each exact 5,000-point milestone up to 150%', () => {
    const run = clearRun();
    expect(run.renderPlayer.speedMps).toBe(BASE_SPEED_MPS * 0.9);
    for (let tier = 1; tier <= 6; tier += 1) {
      const score = tier * 5000;
      const before = BASE_SPEED_MPS * (0.8 + tier * 0.1);
      const target = BASE_SPEED_MPS * (0.9 + tier * 0.1);
      expect(speedLimitForScore(score - 1)).toBeCloseTo(before);
      run.__debugSetBonusScore(
        score - Math.floor(run.renderPlayer.maxForwardM),
      );
      clearTick(run);
      expect(run.renderPlayer.speedMps).toBeCloseTo(
        before + SPEED_RAMP_MPS2 * FIXED_DT,
      );
      expect(run.renderPlayer.speedMps).toBeLessThan(target);
      for (let tick = 1; tick < 181; tick += 1) clearTick(run);
      expect(run.renderPlayer.speedMps).toBeCloseTo(target);
    }
    run.__debugSetBonusScore(1_000_000);
    for (let tick = 0; tick < 120; tick += 1) clearTick(run);
    expect(run.renderPlayer.speedMps).toBe(MAX_SPEED_MPS);
    expect(run.drainEvents()).toEqual([]);
  });

  it('counts an earned jump bonus toward the next milestone', () => {
    const run = clearRun();
    run.__debugSetBonusScore(4800);
    const bus = createTrafficVehicle(
      'bonus-bus',
      'bonus-row',
      'bus',
      'ordinary',
      1,
      -10,
      0,
    );
    bus.airborneOverlap = true;
    run.__debugReplaceTraffic([bus]);
    run.tick(EMPTY_INPUT);
    expect(run.snapshot().score).toBeGreaterThanOrEqual(5000);
    expect(run.renderPlayer.speedMps).toBe(START_SPEED_MPS);
    clearTick(run);
    expect(run.renderPlayer.speedMps).toBeCloseTo(
      START_SPEED_MPS + SPEED_RAMP_MPS2 * FIXED_DT,
    );
  });

  it('pauses the speed ramp and resets it on restart', () => {
    const run = clearRun();
    run.__debugSetBonusScore(5000);
    for (let tick = 0; tick < 60; tick += 1) clearTick(run);
    const speed = run.renderPlayer.speedMps;
    run.setPaused(true);
    for (let tick = 0; tick < 180; tick += 1) run.tick(EMPTY_INPUT);
    expect(run.renderPlayer.speedMps).toBe(speed);
    run.setPaused(false);
    clearTick(run);
    expect(run.renderPlayer.speedMps).toBeGreaterThan(speed);
    run.restart();
    expect(run.snapshot().score).toBe(0);
    expect(run.renderPlayer.speedMps).toBe(START_SPEED_MPS);
  });

  it.each([false, true])(
    'keeps jump flight speed stable across a milestone (double jump: %s)',
    (doubleJump) => {
      const run = clearRun();
      clearTick(run, true);
      if (doubleJump) {
        run.__debugSetBoosters({ doubleJumpCount: 1 });
        clearTick(run, true, true);
      }
      const takeoffSpeed = run.renderPlayer.takeoffSpeedMps;
      run.__debugSetBonusScore(5000);
      for (let tick = 0; tick < 180 && run.renderPlayer.airborne; tick += 1) {
        clearTick(run);
        if (run.renderPlayer.airborne)
          expect(run.renderPlayer.takeoffSpeedMps).toBe(takeoffSpeed);
      }
      expect(run.renderPlayer.airborne).toBe(false);
      expect(run.renderPlayer.speedMps).toBeGreaterThan(takeoffSpeed);
      expect(run.renderPlayer.speedMps).toBeLessThanOrEqual(BASE_SPEED_MPS);
    },
  );

  it('does not credit a whole flight of acceleration for a last-tick milestone', () => {
    const run = clearRun();
    clearTick(run, true);
    for (let tick = 1; tick < 50; tick += 1) clearTick(run);
    expect(run.renderPlayer.airborne).toBe(true);
    expect(run.renderPlayer.speedMps).toBe(START_SPEED_MPS);
    run.__debugSetBonusScore(5000);
    clearTick(run);
    expect(run.renderPlayer.airborne).toBe(false);
    expect(run.renderPlayer.speedMps).toBeCloseTo(
      START_SPEED_MPS + SPEED_RAMP_MPS2 * FIXED_DT,
    );
  });

  it.each([0, 10_000, 30_000])(
    'returns from Yeet to the current score tier at %s points',
    (score) => {
      const run = clearRun();
      run.__debugSetBonusScore(score);
      const boosts = makeBoosterState();
      boosts.rocket = {
        elapsedS: ROCKET_DURATION_S - FIXED_DT,
        startZM: 0,
        startYM: 0,
        landingZM: 480,
      };
      run.__debugSetBoosters(boosts);
      clearTick(run);
      expect(run.renderBoosters.rocket).toBeNull();
      expect(run.renderPlayer.speedMps).toBeCloseTo(speedLimitForScore(score));
      expect(run.snapshot().bonusScore).toBe(score + 750);
    },
  );
});
