import { describe, expect, it } from 'vitest';
import { InputBuffer } from '../app/game/input';
import { parseStoredBest, saveBest } from '../app/game/persistence';

describe('keyboard input buffering', () => {
  it('queues a discrete lane snap and ignores key repeat', () => {
    const input = new InputBuffer();
    input.keyDown('ArrowRight', false);
    input.keyDown('ArrowRight', true);
    expect(input.consume().laneDelta).toBe(1);
    expect(input.consume().laneDelta).toBe(0);
  });

  it('keeps acceleration and Space active while they are held', () => {
    const input = new InputBuffer();
    input.keyDown('ArrowUp');
    input.keyDown('Space');
    expect(input.consume()).toMatchObject({
      accelerate: true,
      jumpPressed: true,
    });
    expect(input.consume()).toMatchObject({
      accelerate: true,
      jumpPressed: true,
    });
    input.keyDown('Space', true);
    expect(input.consume().jumpPressed).toBe(true);
    input.keyUp('Space');
    expect(input.consume().jumpPressed).toBe(false);
    input.keyUp('ArrowUp');
    expect(input.consume().accelerate).toBe(false);
  });

  it('preserves one jump when Space is tapped between fixed ticks', () => {
    const input = new InputBuffer();
    input.keyDown('Space');
    input.keyUp('Space');
    expect(input.consume().jumpPressed).toBe(true);
    expect(input.consume().jumpPressed).toBe(false);
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
