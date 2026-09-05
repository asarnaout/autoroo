import { describe, expect, it } from 'vitest';
import { InputBuffer } from '../app/game/input';
import { AutorooSimulation } from '../app/game/simulation';

describe('mobile driving input', () => {
  it('accepts steering and jumping together while auto-drive accelerates', () => {
    const input = new InputBuffer();
    input.setAutoAccelerate(true);
    input.press('right', 'pointer:11');
    input.press('jump', 'pointer:12');
    expect(input.consume()).toEqual({
      accelerate: true,
      brake: false,
      laneDelta: 1,
      jumpPressed: true,
      jumpTapped: true,
    });
    expect(input.consume()).toMatchObject({
      laneDelta: 0,
      jumpPressed: true,
      jumpTapped: false,
    });
  });

  it('releasing one pointer leaves another pointer or keyboard hold active', () => {
    const input = new InputBuffer();
    input.press('accelerate', 'pointer:1');
    input.press('accelerate', 'pointer:2');
    input.keyDown('ArrowUp');
    input.release('pointer:1');
    input.keyUp('ArrowUp');
    expect(input.consume().accelerate).toBe(true);
    input.release('pointer:2');
    expect(input.consume().accelerate).toBe(false);
    input.keyDown('Space');
    input.press('jump', 'pointer:3');
    input.consume();
    input.release('pointer:3');
    expect(input.consume().jumpPressed).toBe(true);
  });

  it('preserves a quick jump tap and allows a fresh tap for the midair booster', () => {
    const input = new InputBuffer();
    input.press('jump', 'pointer:1');
    input.release('pointer:1');
    expect(input.consume()).toMatchObject({
      jumpPressed: true,
      jumpTapped: true,
    });
    expect(input.consume()).toMatchObject({
      jumpPressed: false,
      jumpTapped: false,
    });
    input.press('jump', 'pointer:2');
    input.consume();
    input.press('jump', 'pointer:2');
    expect(input.consume().jumpTapped).toBe(false);
    input.release('pointer:2');
    input.press('jump', 'pointer:3');
    expect(input.consume().jumpTapped).toBe(true);
  });

  it('safely accepts cancel, lost capture, and late pointer-up releases', () => {
    const input = new InputBuffer();
    input.press('brake', 'pointer:5');
    input.release('pointer:5');
    input.release('pointer:5');
    input.release('pointer:5');
    expect(input.consume().brake).toBe(false);
  });

  it('clears held controls and pending taps on pause/restart without forgetting driving mode', () => {
    const input = new InputBuffer();
    input.setAutoAccelerate(true);
    input.press('brake', 'pointer:1');
    input.press('jump', 'pointer:2');
    input.press('left', 'pointer:3');
    input.clear();
    expect(input.consume()).toEqual({
      accelerate: true,
      brake: false,
      laneDelta: 0,
      jumpPressed: false,
      jumpTapped: false,
    });
    input.setAutoAccelerate(false);
    expect(input.consume().accelerate).toBe(false);
  });

  it('drives, brakes, steers, and jumps through the production simulation without a keyboard', () => {
    const input = new InputBuffer();
    input.setAutoAccelerate(true);
    const run = new AutorooSimulation(0xa770_2026);
    run.start();
    for (let tick = 0; tick < 60; tick += 1) run.tick(input.consume());
    const driving = run.snapshot();
    expect(driving.player.speedMps).toBeGreaterThan(0);
    expect(driving.player.absoluteZM).toBeGreaterThan(0);
    input.press('brake', 'pointer:1');
    for (let tick = 0; tick < 10; tick += 1) run.tick(input.consume());
    expect(run.snapshot().player.speedMps).toBeLessThan(
      driving.player.speedMps,
    );
    input.release('pointer:1');
    input.press('right', 'pointer:2');
    input.press('jump', 'pointer:3');
    run.tick(input.consume());
    expect(run.snapshot().player.airborne).toBe(true);
    expect(run.snapshot().player.laneChangeDirection).toBe(1);
    expect(run.snapshot().player.yM).toBeGreaterThan(0);
  });
});
