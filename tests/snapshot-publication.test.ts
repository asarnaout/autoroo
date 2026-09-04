import { describe, expect, it } from 'vitest';
import type { InputFrame, RunPhase, RunSnapshot } from '../app/game/contracts';
import {
  AutorooSimulation,
  createTrafficVehicle,
} from '../app/game/simulation';
import {
  SNAPSHOT_PUBLISH_INTERVAL_TICKS,
  shouldPublishRunSnapshot,
} from '../app/game/snapshotPublication';

const idle: InputFrame = {
  accelerate: false,
  brake: false,
  laneDelta: 0,
  jumpPressed: false,
};

describe('run snapshot publication cadence', () => {
  it('keeps ordinary running HUD updates at 10 Hz', () => {
    expect(
      shouldPublishRunSnapshot(false, 101, 100, 'running', 'running'),
    ).toBe(false);
    expect(
      shouldPublishRunSnapshot(
        false,
        100 + SNAPSHOT_PUBLISH_INTERVAL_TICKS,
        100,
        'running',
        'running',
      ),
    ).toBe(true);
  });

  it('always publishes a game-over transition before its tick freezes', () => {
    // This is the timing that previously left React holding a stale running
    // snapshot forever after the player rear-ended traffic.
    expect(
      shouldPublishRunSnapshot(false, 101, 100, 'game-over', 'running'),
    ).toBe(true);
    expect(
      shouldPublishRunSnapshot(false, 101, 101, 'game-over', 'game-over'),
    ).toBe(false);
  });

  it('delivers the final snapshot after rear-ending slower traffic', () => {
    const simulation = new AutorooSimulation(22);
    simulation.start();
    simulation.__debugReplaceTraffic([
      createTrafficVehicle(
        'slow-ahead',
        'rear-end',
        'sedan',
        'ordinary',
        1,
        5,
        6,
      ),
    ]);
    simulation.__debugSetPlayer({
      lane: 1,
      absoluteZM: 0,
      previousZM: 0,
      speedMps: 30,
    });

    let lastPublishedTick = 0;
    let lastPublishedPhase: RunPhase | null = 'running';
    const delivered: RunSnapshot[] = [];
    for (let frame = 0; frame < 5; frame += 1) {
      simulation.tick(idle);
      const snapshot = simulation.snapshot();
      if (
        shouldPublishRunSnapshot(
          false,
          snapshot.tick,
          lastPublishedTick,
          snapshot.phase,
          lastPublishedPhase,
        )
      ) {
        delivered.push(snapshot);
        lastPublishedTick = snapshot.tick;
        lastPublishedPhase = snapshot.phase;
      }
    }

    expect(simulation.snapshot()).toMatchObject({
      tick: 3,
      phase: 'game-over',
    });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ tick: 3, phase: 'game-over' });
  });

  it('publishes every lifecycle transition even without a new tick', () => {
    expect(shouldPublishRunSnapshot(false, 80, 80, 'paused', 'running')).toBe(
      true,
    );
    expect(shouldPublishRunSnapshot(false, 0, 80, 'running', 'game-over')).toBe(
      true,
    );
    expect(shouldPublishRunSnapshot(true, 0, 0, 'running', 'running')).toBe(
      true,
    );
  });
});
