import { describe, expect, it } from 'vitest';
import { InputBuffer } from '../app/game/input';
import { SteeringPadInput } from '../app/game/steeringPad';
import { AutorooSimulation } from '../app/game/simulation';

const bounds = { left: 16, top: 500, width: 224, height: 128 };

function setup() {
  const input = new InputBuffer();
  const pad = new SteeringPadInput(
    (control, source) => input.press(control, source),
    (source) => input.release(source),
  );
  return { input, pad };
}

describe('mobile steering pad', () => {
  it.each([
    [18, 502, -1],
    [127, 560, -1],
    [128, 560, 1],
    [130, 625, 1],
    [238, 502, 1],
  ])(
    'accepts the broad pad at (%i, %i), including its divider and corners',
    (x, y, laneDelta) => {
      const { input, pad } = setup();
      expect(pad.pointerDown('steering:1', x, y, bounds)).toBe(true);
      expect(input.consume().laneDelta).toBe(laneDelta);
      expect(input.consume().laneDelta).toBe(0);
    },
  );

  it('reverses with a slide while a different thumb continues holding Jump', () => {
    const { input, pad } = setup();
    input.press('jump', 'pointer:2');
    pad.pointerDown('steering:1', 70, 550, bounds);
    expect(input.consume()).toEqual({
      laneDelta: -1,
      jumpPressed: true,
      jumpTapped: true,
    });
    pad.pointerMove('steering:1', 190, 570);
    expect(input.consume()).toEqual({
      laneDelta: 1,
      jumpPressed: true,
      jumpTapped: false,
    });
    pad.release('steering:1');
    expect(input.consume().jumpPressed).toBe(true);
    input.release('pointer:2');
    input.press('jump', 'pointer:3');
    expect(input.consume().jumpTapped).toBe(true);
  });

  it('does not repeat lanes on hold or jitter around the centre line', () => {
    const { input, pad } = setup();
    pad.pointerDown('steering:1', 120, 550, bounds);
    input.consume();
    for (const x of [124, 130, 125, 138, 129, 136]) {
      pad.pointerMove('steering:1', x, 550);
      expect(input.consume().laneDelta).toBe(0);
    }
    pad.pointerMove('steering:1', 142, 550);
    expect(input.consume().laneDelta).toBe(1);
    for (const x of [136, 127, 120, 180, 240, 300]) {
      pad.pointerMove('steering:1', x, 550);
      expect(input.consume().laneDelta).toBe(0);
    }
    pad.pointerMove('steering:1', 110, 550);
    expect(input.consume().laneDelta).toBe(-1);
  });

  it('lets each new tap request another lane immediately without a swipe threshold', () => {
    const { input, pad } = setup();
    for (let i = 0; i < 3; i += 1) {
      pad.pointerDown('steering:1', 129, 550, bounds);
      pad.release('steering:1');
      expect(input.consume().laneDelta).toBe(1);
    }
  });

  it('does not acquire a gesture from outside the pad or from a different pointer', () => {
    const { input, pad } = setup();
    expect(pad.pointerDown('steering:1', 300, 550, bounds)).toBe(false);
    expect(pad.pointerMove('steering:1', 50, 550)).toBe(false);
    pad.pointerDown('steering:2', 70, 550, bounds);
    input.consume();
    expect(pad.pointerMove('pointer:jump', 200, 550)).toBe(false);
    expect(pad.pointerMove('steering:2', 200, 700)).toBe(false);
    expect(input.consume()).toEqual({
      laneDelta: 0,
      jumpPressed: false,
      jumpTapped: false,
    });
  });

  it('releases cancelled contacts idempotently and ignores later captured moves', () => {
    const { input, pad } = setup();
    pad.pointerDown('steering:1', 70, 550, bounds);
    input.consume();
    expect(pad.release('steering:1')).toBe(true);
    expect(pad.release('steering:1')).toBe(false);
    expect(pad.pointerMove('steering:1', 200, 550)).toBe(false);
    expect(pad.isPressed('left')).toBe(false);
    expect(input.consume().laneDelta).toBe(0);
  });

  it('clears contact geometry on rotation/pause teardown and accepts fresh contacts', () => {
    const { input, pad } = setup();
    pad.pointerDown('steering:1', 70, 550, bounds);
    pad.press('right', 'steering:right:Space');
    input.consume();
    input.consume();
    pad.clear();
    expect(pad.isPressed('left')).toBe(false);
    expect(pad.isPressed('right')).toBe(false);
    pad.pointerMove('steering:1', 220, 550);
    expect(input.consume().laneDelta).toBe(0);
    pad.pointerDown('steering:1', 80, 220, {
      left: 20,
      top: 200,
      width: 256,
      height: 104,
    });
    expect(input.consume().laneDelta).toBe(-1);
  });

  it('leaves another contact pressed when one finger lifts', () => {
    const { input, pad } = setup();
    pad.pointerDown('steering:1', 70, 550, bounds);
    pad.pointerDown('steering:2', 90, 570, bounds);
    input.consume();
    input.consume();
    pad.release('steering:1');
    expect(pad.isPressed('left')).toBe(true);
    pad.release('steering:2');
    expect(pad.isPressed('left')).toBe(false);
  });

  it('uses the normal lane-roll and jump in the production simulation', () => {
    const { input, pad } = setup();
    const run = new AutorooSimulation(0xa770_2026);
    run.start();
    for (let tick = 0; tick < 60; tick += 1) run.tick(input.consume());
    pad.pointerDown('steering:1', 200, 550, bounds);
    input.press('jump', 'pointer:2');
    run.tick(input.consume());
    expect(run.snapshot().player.airborne).toBe(true);
    expect(run.snapshot().player.laneChangeDirection).toBe(1);
    expect(run.snapshot().player.yM).toBeGreaterThan(0);
  });
});
