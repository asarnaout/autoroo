import { describe, expect, it } from 'vitest';
import {
  CRASH_DURATION_S,
  CRASH_LANDING_S,
  CrashAnimation,
  type CrashPose,
} from '../app/game/crashAnimation';
import {
  AutorooSimulation,
  createTrafficVehicle,
} from '../app/game/simulation';

const neutral: CrashPose = {
  xM: -1.8,
  yM: 0,
  zM: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
};

describe('cartoon crash presentation', () => {
  it.each(['sedan', 'suv', 'bus'] as const)(
    'animates after a %s hit without advancing the run',
    (kind) => {
      const simulation = new AutorooSimulation(22);
      simulation.start();
      simulation.__debugReplaceTraffic([
        createTrafficVehicle('impact', 'crash-test', kind, 'ordinary', 1, 4, 6),
      ]);
      simulation.tick({ laneDelta: 0, jumpPressed: false });
      const events = simulation.drainEvents();
      expect(events.filter((event) => event.type === 'crash')).toHaveLength(1);
      const frozen = simulation.snapshot();
      expect(frozen.phase).toBe('game-over');
      const animation = new CrashAnimation();
      animation.start(neutral, 1, false);
      let completions = 0;
      for (let i = 0; i < 120; i += 1) {
        simulation.tick({ laneDelta: 1, jumpPressed: true });
        if (animation.advance(1 / 60)) completions += 1;
      }
      expect(completions).toBe(1);
      expect(simulation.snapshot()).toEqual(frozen);
      expect(simulation.drainEvents()).toEqual([]);
    },
  );

  it('starts at the existing airborne pose, stays finite and lands before completion', () => {
    const animation = new CrashAnimation();
    const airborne = {
      ...neutral,
      yM: 1.7,
      pitch: -0.12,
      roll: 0.6,
      scaleY: 1.15,
    };
    animation.start(airborne, -1, false);
    expect(animation.pose()).toMatchObject({
      xM: airborne.xM,
      yM: airborne.yM,
      scaleY: 1.15,
    });
    let maximumHeight = 0;
    for (let i = 0; i < 240; i += 1) {
      animation.advance(CRASH_DURATION_S / 240);
      const pose = animation.pose()!;
      expect(Object.values(pose).every(Number.isFinite)).toBe(true);
      expect(pose.yM).toBeGreaterThanOrEqual(0);
      expect(Math.min(pose.scaleX, pose.scaleY, pose.scaleZ)).toBeGreaterThan(
        0.45,
      );
      maximumHeight = Math.max(maximumHeight, pose.yM);
      if ((i * CRASH_DURATION_S) / 240 >= CRASH_LANDING_S)
        expect(pose.yM).toBeCloseTo(0, 5);
    }
    expect(maximumHeight).toBeGreaterThan(2);
    expect(maximumHeight).toBeLessThan(5);
    expect(animation.pose()!.zM).toBeLessThan(-1);
  });

  it('resets an interrupted reaction and never fires an old completion after restart', () => {
    const animation = new CrashAnimation();
    animation.start(neutral, 1, false);
    animation.advance(0.5);
    animation.reset();
    expect(animation.pose()).toBeNull();
    expect(animation.advance(5)).toBe(false);
    animation.start(neutral, -1, false);
    expect(animation.advance(0)).toBe(false);
    expect(animation.advance(CRASH_DURATION_S)).toBe(true);
    expect(animation.advance(1)).toBe(false);
  });

  it('keeps reduced motion free of tumbling and completes promptly', () => {
    const animation = new CrashAnimation();
    animation.start(neutral, 1, true);
    animation.advance(0.2);
    expect(animation.pose()).toMatchObject({
      pitch: 0,
      roll: 0,
      yaw: 0,
      yM: 0,
      xM: neutral.xM,
    });
    expect(animation.advance(0.2)).toBe(true);
  });
});
