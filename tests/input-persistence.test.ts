import { describe, expect, it } from 'vitest';
import { InputBuffer, isGameKey } from '../app/game/input';
import {
  createDoubleJumpHintClaim,
  parseStoredBest,
  saveBest,
} from '../app/game/persistence';
import { AutorooSimulation } from '../app/game/simulation';

describe('keyboard input buffering', () => {
  it.each([
    ['ArrowLeft', -1],
    ['KeyA', -1],
    ['ArrowRight', 1],
    ['KeyD', 1],
  ] as const)(
    'queues one lane snap for %s and ignores key repeat',
    (code, direction) => {
      const input = new InputBuffer();
      expect(isGameKey(code)).toBe(true);
      input.keyDown(code, false);
      input.keyDown(code, true);
      expect(input.consume().laneDelta).toBe(direction);
      expect(input.consume().laneDelta).toBe(0);
    },
  );

  it.each(['Space', 'ArrowUp', 'KeyW'])(
    'keeps %s active while held without generating repeated taps',
    (code) => {
      const input = new InputBuffer();
      expect(isGameKey(code)).toBe(true);
      input.keyDown(code);
      expect(input.consume()).toMatchObject({
        jumpPressed: true,
        jumpTapped: true,
      });
      expect(input.consume()).toMatchObject({
        jumpPressed: true,
        jumpTapped: false,
      });
      input.keyDown(code, true);
      expect(input.consume()).toMatchObject({
        jumpPressed: true,
        jumpTapped: false,
      });
      input.keyUp(code);
      expect(input.consume().jumpPressed).toBe(false);
    },
  );

  it.each(['Space', 'ArrowUp', 'KeyW'])(
    'preserves one jump when %s is tapped between fixed ticks',
    (code) => {
      const input = new InputBuffer();
      input.keyDown(code);
      input.keyUp(code);
      expect(input.consume().jumpPressed).toBe(true);
      expect(input.consume().jumpPressed).toBe(false);
    },
  );

  it('always drives on desktop and ignores the former brake key', () => {
    const input = new InputBuffer();
    const run = new AutorooSimulation(0xa770_2026);
    run.start();
    for (let tick = 0; tick < 60; tick += 1) run.tick(input.consume());
    const driving = run.snapshot().player;
    expect(driving.absoluteZM).toBeGreaterThan(0);
    expect(driving.speedMps).toBeGreaterThan(0);

    input.keyDown('ArrowDown');
    expect(isGameKey('ArrowDown')).toBe(false);
    for (let tick = 0; tick < 10; tick += 1) run.tick(input.consume());
    const speedWhileDownHeld = run.snapshot().player.speedMps;
    expect(speedWhileDownHeld).toBe(driving.speedMps);
    input.keyUp('ArrowDown');
    for (let tick = 0; tick < 10; tick += 1) run.tick(input.consume());
    expect(run.snapshot().player.speedMps).toBe(speedWhileDownHeld);

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

describe('first-collection double-jump hint', () => {
  it('shows once and stays dismissed when a new app session uses the same storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    saveBest(314, storage);
    const claim = createDoubleJumpHintClaim(storage);
    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
    expect(claim()).toBe(false);
    // Simulate a page reload: the new claim has no in-memory history.
    expect(createDoubleJumpHintClaim(storage)()).toBe(false);
    expect(parseStoredBest(storage.getItem('autoroo.best.v1'))).toBe(314);
  });

  it('suppresses repeats within the session when browser storage is unavailable', () => {
    const claim = createDoubleJumpHintClaim(null);
    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
  });

  it.each(['read', 'write'] as const)(
    'survives blocked storage %s without repeating the hint',
    (operation) => {
      const claim = createDoubleJumpHintClaim({
        getItem: () => {
          if (operation === 'read') throw new Error('Storage denied');
          return null;
        },
        setItem: () => {
          if (operation === 'write') throw new Error('Quota exceeded');
        },
      });
      expect(claim()).toBe(true);
      expect(claim()).toBe(false);
    },
  );
});
