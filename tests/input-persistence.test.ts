import { describe, expect, it } from 'vitest';
import { InputBuffer, isGameKey } from '../app/game/input';
import { parseStoredBest, saveBest } from '../app/game/persistence';
import { AutorooSimulation } from '../app/game/simulation';

describe('keyboard input buffering', () => {
  it('queues a discrete lane snap and ignores key repeat', () => {
    const input = new InputBuffer();
    input.keyDown('ArrowRight', false);
    input.keyDown('ArrowRight', true);
    expect(input.consume().laneDelta).toBe(1);
    expect(input.consume().laneDelta).toBe(0);
  });

  it('keeps Space active while held without generating repeated taps', () => {
    const input = new InputBuffer();
    input.keyDown('Space');
    expect(input.consume()).toMatchObject({
      jumpPressed: true,
      jumpTapped: true,
    });
    expect(input.consume()).toMatchObject({
      jumpPressed: true,
      jumpTapped: false,
    });
    input.keyDown('Space', true);
    expect(input.consume().jumpPressed).toBe(true);
    input.keyUp('Space');
    expect(input.consume().jumpPressed).toBe(false);
  });

  it('preserves one jump when Space is tapped between fixed ticks', () => {
    const input = new InputBuffer();
    input.keyDown('Space');
    input.keyUp('Space');
    expect(input.consume().jumpPressed).toBe(true);
    expect(input.consume().jumpPressed).toBe(false);
  });

  it('always drives on desktop and ignores the former speed-control keys', () => {
    const input = new InputBuffer();
    const run = new AutorooSimulation(0xa770_2026);
    run.start();
    for (let tick = 0; tick < 60; tick += 1) run.tick(input.consume());
    const driving = run.snapshot().player;
    expect(driving.absoluteZM).toBeGreaterThan(0);
    expect(driving.speedMps).toBeGreaterThan(0);

    input.keyDown('ArrowDown');
    expect(isGameKey('ArrowDown')).toBe(false);
    expect(isGameKey('ArrowUp')).toBe(false);
    for (let tick = 0; tick < 10; tick += 1) run.tick(input.consume());
    const speedWhileDownHeld = run.snapshot().player.speedMps;
    expect(speedWhileDownHeld).toBeGreaterThan(driving.speedMps);
    input.keyUp('ArrowDown');
    for (let tick = 0; tick < 10; tick += 1) run.tick(input.consume());
    expect(run.snapshot().player.speedMps).toBeGreaterThan(speedWhileDownHeld);

    input.keyDown('ArrowRight');
    input.keyDown('Space');
    run.tick(input.consume());
    expect(run.snapshot().player.laneChangeDirection).toBe(1);
    expect(run.snapshot().player.airborne).toBe(true);

    run.setPaused(true);
    input.clear();
    const paused = run.snapshot().player.absoluteZM;
    for (let tick = 0; tick < 10; tick += 1) run.tick(input.consume());
    expect(run.snapshot().player.absoluteZM).toBe(paused);
    run.restart();
    for (let tick = 0; tick < 10; tick += 1) run.tick(input.consume());
    expect(run.snapshot().player.speedMps).toBeGreaterThan(0);
    expect(run.snapshot().player.airborne).toBe(false);
  });
});

describe('versioned personal best persistence', () => {
  it('rejects malformed, negative, fractional, stale, and oversized scores', () => {
    expect(parseStoredBest(null)).toBe(0);
    expect(parseStoredBest('{oops')).toBe(0);
    expect(parseStoredBest('{"version":2,"best":10}')).toBe(0);
    expect(parseStoredBest('{"version":1,"best":-1}')).toBe(0);
    expect(parseStoredBest('{"version":1,"best":1.5}')).toBe(0);
    expect(parseStoredBest('{"version":1,"best":1000000000}')).toBe(0);
    expect(parseStoredBest('{"version":1,"best":321}')).toBe(321);
  });

  it('writes the validated v1 envelope', () => {
    let value = '';
    const storage = {
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    expect(saveBest(19.9, storage)).toBe(true);
    expect(JSON.parse(value)).toEqual({ version: 1, best: 19 });
  });
});
