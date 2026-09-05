import { describe, expect, it } from 'vitest';
import {
  BOOSTER_POOL_SIZE,
  DOUBLE_JUMP_IMPULSE_MPS,
  ROCKET_BONUS,
  ROCKET_DISTANCE_M,
  ROCKET_DURATION_S,
  ROCKET_HEIGHT_M,
  SHIELD_GRACE_S,
  boosterAtStation,
  collectsBooster,
} from '../app/game/boosters';
import {
  EMPTY_INPUT,
  ACCELERATION_MPS2,
  FIXED_DT,
  LANE_X,
  MAX_SPEED_MPS,
  activeLanes,
  hasLane,
} from '../app/game/constants';
import type {
  BoosterKind,
  BoosterPickup,
  InputFrame,
} from '../app/game/contracts';
import { laneMaskAt, isSteadyRoadRange } from '../app/game/generator';
import { InputBuffer } from '../app/game/input';
import {
  AutorooSimulation,
  createTrafficVehicle,
  runRenderSchedule,
} from '../app/game/simulation';

const drive: InputFrame = { ...EMPTY_INPUT };
const tap: InputFrame = { ...drive, jumpPressed: true, jumpTapped: true };

function emptyRun(seed = 17) {
  const run = new AutorooSimulation(seed);
  run.start();
  run.__debugReplaceTraffic([]);
  run.__debugReplacePickups([]);
  return run;
}

function pickup(kind: BoosterKind, z = 0, y = 1.2): BoosterPickup {
  return { id: `test-${kind}`, kind, lane: 1, absoluteZM: z, yM: y };
}

function clearTick(run: AutorooSimulation, input: InputFrame = drive) {
  run.__debugReplaceTraffic([]);
  run.tick(input);
}

describe('collectible generation and collection', () => {
  it('repeats deterministically with ordered rarity and manoeuvre targets on stable road', () => {
    const counts = { boing: 0, shield: 0, rocket: 0 };
    for (let seed = 0; seed < 20; seed += 1) {
      for (let station = 0; station < 240; station += 1) {
        const item = boosterAtStation(seed, station);
        expect(item).toEqual(boosterAtStation(seed, station));
        if (!item) continue;
        counts[item.kind] += 1;
        expect(
          isSteadyRoadRange(seed, item.absoluteZM - 20, item.absoluteZM + 20),
        ).toBe(true);
        const lanes = activeLanes(laneMaskAt(seed, item.absoluteZM));
        expect(item.lane).toBe(station % 2 === 0 ? lanes.at(-1) : lanes[0]);
      }
    }
    expect(counts.boing).toBeGreaterThan(counts.shield * 2);
    expect(counts.shield).toBeGreaterThan(counts.rocket * 2);
    expect(counts.rocket).toBeGreaterThan(100);
  });

  it('requires lane alignment, and a jump for bubbles and rockets', () => {
    const player = emptyRun().snapshot().player;
    expect(collectsBooster(player, pickup('boing'))).toBe(true);
    expect(
      collectsBooster(
        { ...player, xM: LANE_X[2], previousXM: LANE_X[2] },
        pickup('boing'),
      ),
    ).toBe(false);
    expect(collectsBooster(player, pickup('shield', 0, 3.4))).toBe(false);
    expect(collectsBooster(player, pickup('rocket', 0, 4.8))).toBe(false);
    expect(
      collectsBooster(
        { ...player, yM: 4.3, previousYM: 4.3 },
        pickup('rocket', 0, 4.8),
      ),
    ).toBe(true);
  });

  it('sweeps through pickups at high speed without combining disjoint axis overlaps', () => {
    const player = emptyRun().snapshot().player;
    expect(
      collectsBooster(
        { ...player, previousZM: -5, absoluteZM: 5 },
        pickup('boing'),
      ),
    ).toBe(true);
    const laneTwoPickup = { ...pickup('boing'), lane: 2 as const };
    expect(
      collectsBooster(
        { ...player, previousZM: 0, absoluteZM: 20, xM: LANE_X[2] },
        laneTwoPickup,
      ),
    ).toBe(false);
    expect(
      collectsBooster(
        { ...player, previousZM: -4, absoluteZM: 0, xM: LANE_X[2] },
        laneTwoPickup,
      ),
    ).toBe(true);
  });

  it('collects once, caps inventory at one, and restart clears every ability', () => {
    const run = emptyRun();
    run.__debugReplacePickups([pickup('boing'), pickup('shield')]);
    run.tick(EMPTY_INPUT);
    expect(run.snapshot().boosters).toMatchObject({
      doubleJumpReady: true,
      shieldReady: true,
    });
    expect(
      run.drainEvents().filter((event) => event.type === 'pickup'),
    ).toHaveLength(2);
    run.__debugReplacePickups([pickup('shield')]);
    run.tick(EMPTY_INPUT);
    expect(run.snapshot().boosters.shieldReady).toBe(true);
    expect(run.snapshot().boosters.notice).toContain('already');
    run.tick(EMPTY_INPUT);
    expect(
      run.drainEvents().filter((event) => event.type === 'pickup'),
    ).toHaveLength(1);
    run.restart();
    expect(run.snapshot().boosters).toMatchObject({
      doubleJumpReady: false,
      shieldReady: false,
      protectionS: 0,
      rocket: null,
      effect: null,
    });
  });

  it('retains only a bounded live pickup window through 100 km of forward progress', () => {
    const run = emptyRun();
    for (let distance = 0; distance < 100_000; distance += 100) {
      run.__debugSetPlayer({
        absoluteZM: distance,
        previousZM: distance,
        maxForwardM: distance,
        speedMps: MAX_SPEED_MPS,
      });
      clearTick(run);
      expect(run.renderPickups.length).toBeLessThanOrEqual(BOOSTER_POOL_SIZE);
      expect(
        run.renderPickups.every((item) => item.absoluteZM > distance - 6),
      ).toBe(true);
    }
  });
});

describe('Boing! double jump', () => {
  it('keeps held auto-hop and key repeat from consuming a charge, but accepts a second tap between ticks', () => {
    const run = emptyRun();
    run.__debugSetBoosters({ doubleJumpReady: true });
    const keys = new InputBuffer();
    keys.keyDown('Space');
    clearTick(run, keys.consume());
    for (let tick = 0; tick < 30; tick += 1) {
      keys.keyDown('Space', true);
      clearTick(run, keys.consume());
    }
    expect(run.snapshot().boosters.doubleJumpReady).toBe(true);
    keys.keyUp('Space');
    keys.keyDown('Space');
    keys.keyUp('Space');
    const height = run.renderPlayer.yM;
    clearTick(run, keys.consume());
    expect(run.renderPlayer.yM).toBeGreaterThan(height);
    expect(run.renderPlayer.verticalSpeedMps).toBeGreaterThan(
      DOUBLE_JUMP_IMPULSE_MPS - 1,
    );
    expect(run.snapshot().boosters.doubleJumpReady).toBe(false);
    expect(
      run.drainEvents().filter((event) => event.type === 'double-jump'),
    ).toHaveLength(1);
  });

  it.each([2, 25, 49])(
    'refreshes upward velocity and gives over 1.6 seconds of airtime at jump tick %i',
    (jumpTick) => {
      const run = emptyRun();
      run.__debugSetBoosters({ doubleJumpReady: true });
      clearTick(run, tap);
      for (let i = 1; i < jumpTick; i += 1) clearTick(run);
      const height = run.renderPlayer.yM;
      clearTick(run, tap);
      expect(run.renderPlayer.yM).toBeGreaterThan(height);
      let ticks = 0;
      while (run.renderPlayer.airborne && ticks < 180) {
        clearTick(run);
        ticks += 1;
      }
      expect(ticks * FIXED_DT).toBeGreaterThan(1.6);
      expect(run.renderPlayer.yM).toBe(0);
      expect(run.renderPlayer.speedMps).toBeCloseTo(
        Math.min(MAX_SPEED_MPS, run.renderTick * FIXED_DT * ACCELERATION_MPS2),
        8,
      );
      expect(run.phaseName).toBe('running');
    },
  );

  it('cannot triple jump, even if a second spring is collected in flight', () => {
    const run = emptyRun();
    run.__debugSetBoosters({ doubleJumpReady: true });
    clearTick(run, tap);
    clearTick(run, tap);
    run.__debugSetBoosters({ doubleJumpReady: true });
    for (let i = 0; i < 10; i += 1) clearTick(run, tap);
    expect(
      run.drainEvents().filter((event) => event.type === 'double-jump'),
    ).toHaveLength(1);
    expect(run.snapshot().boosters.doubleJumpReady).toBe(true);
    while (run.renderPlayer.airborne) clearTick(run);
    clearTick(run, tap);
    clearTick(run, tap);
    expect(
      run.drainEvents().filter((event) => event.type === 'double-jump'),
    ).toHaveLength(1);
  });

  it('uses the boosted altitude for collision detection when jumping a bus', () => {
    const run = emptyRun();
    run.__debugSetBoosters({ doubleJumpReady: true });
    clearTick(run, tap);
    for (let i = 0; i < 25; i += 1) clearTick(run);
    clearTick(run, tap);
    for (let i = 0; i < 25; i += 1) clearTick(run);
    run.__debugReplaceTraffic([
      createTrafficVehicle(
        'under-bus',
        'test',
        'bus',
        'ordinary',
        1,
        run.renderPlayer.absoluteZM,
        0,
      ),
    ]);
    run.tick(drive);
    expect(run.renderPlayer.yM).toBeGreaterThan(8);
    expect(run.phaseName).toBe('running');
  });
});

describe('Bubble Buddy', () => {
  it('absorbs one multi-car contact, clears those colliders, then lets the next crash end the run', () => {
    const run = emptyRun();
    run.__debugSetBoosters({ shieldReady: true });
    run.__debugReplaceTraffic([
      createTrafficVehicle('bonk-1', 'test', 'sedan', 'ordinary', 1, 0, 0),
      createTrafficVehicle('bonk-2', 'test', 'bus', 'ordinary', 1, 1, 0),
    ]);
    run.tick(EMPTY_INPUT);
    expect(run.phaseName).toBe('running');
    expect(run.snapshot().boosters).toMatchObject({
      shieldReady: false,
      protectionS: SHIELD_GRACE_S,
    });
    expect(
      run.renderTraffic.some((vehicle) => vehicle.id.startsWith('bonk')),
    ).toBe(false);
    expect(run.snapshot().bonusScore).toBe(0);
    expect(
      run.drainEvents().filter((event) => event.type === 'shield-pop'),
    ).toHaveLength(1);
    for (let i = 0; i < 100; i += 1) run.tick(EMPTY_INPUT);
    expect(run.phaseName).toBe('running');
    run.__debugReplaceTraffic([
      createTrafficVehicle(
        'second-hit',
        'test',
        'sedan',
        'ordinary',
        1,
        run.renderPlayer.absoluteZM,
        0,
      ),
    ]);
    run.tick(EMPTY_INPUT);
    expect(run.phaseName).toBe('game-over');
  });

  it('blocks another contact during recovery and freezes the timer while paused', () => {
    const run = emptyRun();
    run.__debugSetBoosters({ shieldReady: true });
    run.__debugReplaceTraffic([
      createTrafficVehicle('hit', 'test', 'sedan', 'ordinary', 1, 0, 0),
    ]);
    run.tick(EMPTY_INPUT);
    run.setPaused(true);
    const paused = run.snapshot();
    for (let i = 0; i < 600; i += 1) run.tick(tap);
    expect(run.snapshot()).toEqual(paused);
    run.setPaused(false);
    run.__debugReplaceTraffic([
      createTrafficVehicle('grace-hit', 'test', 'sedan', 'ordinary', 1, 0, 0),
    ]);
    run.tick(EMPTY_INPUT);
    expect(run.phaseName).toBe('running');
  });
});

describe('Yeet Rocket', () => {
  it.each([0, 17, 55, 444])(
    'flies fast, preserves inventory and returns control on a clear active lane (seed %i)',
    (seed) => {
      const run = emptyRun(seed);
      const startM = 127;
      run.__debugSetPlayer({
        absoluteZM: startM,
        previousZM: startM,
        maxForwardM: startM,
      });
      run.__debugSetBoosters({ doubleJumpReady: true, shieldReady: true });
      run.__debugReplacePickups([pickup('rocket', startM)]);
      run.tick(EMPTY_INPUT);
      const launch = run.snapshot();
      expect(launch.boosters.rocket).not.toBeNull();
      const landingM = launch.boosters.rocket!.landingZM;
      run.__debugReplaceTraffic([
        createTrafficVehicle(
          'takeoff-bus',
          'test',
          'bus',
          'gate',
          1,
          startM + 3,
          0,
        ),
        createTrafficVehicle(
          'landing-bus',
          'test',
          'bus',
          'gate',
          1,
          landingM,
          0,
        ),
        createTrafficVehicle(
          'landing-suv',
          'test',
          'suv',
          'ordinary',
          2,
          landingM + 25,
          0,
        ),
      ]);
      let maxHeight = 0;
      for (let i = 0; i < ROCKET_DURATION_S / FIXED_DT; i += 1) {
        run.tick({ ...tap, laneDelta: -1 });
        maxHeight = Math.max(maxHeight, run.renderPlayer.yM);
        expect(run.phaseName).toBe('running');
      }
      const after = run.snapshot();
      expect(maxHeight).toBeGreaterThanOrEqual(ROCKET_HEIGHT_M - 0.1);
      expect(after.player.absoluteZM - launch.player.absoluteZM).toBeCloseTo(
        ROCKET_DISTANCE_M,
        6,
      );
      expect(after.boosters.rocket).toBeNull();
      expect(after.player).toMatchObject({
        airborne: false,
        yM: 0,
        speedMps: MAX_SPEED_MPS,
      });
      expect(hasLane(after.laneMask, after.player.lane)).toBe(true);
      expect(after.boosters).toMatchObject({
        doubleJumpReady: true,
        shieldReady: true,
      });
      expect(
        after.traffic.every((vehicle) => vehicle.absoluteZM > landingM + 90),
      ).toBe(true);
      expect(after.bonusScore).toBeGreaterThanOrEqual(ROCKET_BONUS);
      expect(
        run.drainEvents().filter((event) => event.type === 'rocket-land'),
      ).toHaveLength(1);
      const previousLane = run.renderPlayer.lane;
      run.tick({ ...drive, laneDelta: previousLane === 1 ? 1 : -1 });
      expect(run.renderPlayer.lane).not.toBe(previousLane);
      for (let i = 0; i < 120; i += 1) run.tick(drive);
      expect(run.phaseName).toBe('running');
    },
  );

  it('pauses mid-flight without moving, consuming inventory or awarding the landing twice', () => {
    const run = emptyRun();
    run.__debugReplacePickups([pickup('rocket')]);
    run.tick(EMPTY_INPUT);
    for (let i = 0; i < 100; i += 1) run.tick(drive);
    run.setPaused(true);
    const snapshot = run.snapshot();
    for (let i = 0; i < 100; i += 1) run.tick(tap);
    expect(run.snapshot()).toEqual(snapshot);
    run.setPaused(false);
    for (let i = 0; i < 160; i += 1) run.tick(drive);
    expect(
      run.drainEvents().filter((event) => event.type === 'rocket-land'),
    ).toHaveLength(1);
  });

  it('replays booster state identically at 30, 60 and 144 Hz', () => {
    const run = (hz: number) => {
      const simulation = emptyRun();
      simulation.__debugReplacePickups([pickup('rocket')]);
      return runRenderSchedule(
        simulation,
        Array.from({ length: hz * 5 }, () => 1 / hz),
        () => drive,
      );
    };
    expect(run(30)).toBe(run(60));
    expect(run(144)).toBe(run(60));
  });
});
