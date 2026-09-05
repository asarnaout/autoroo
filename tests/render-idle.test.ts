import { afterEach, describe, expect, it, vi } from 'vitest';
import { BabylonGameSession } from '../app/game/BabylonGameSession';
import { CrashAnimation } from '../app/game/crashAnimation';
import { AdaptiveRenderQuality } from '../app/game/renderQuality';
import { AutorooSimulation } from '../app/game/simulation';
import { InputBuffer } from '../app/game/input';

// Exercise the actual frame loop with scene/audio boundaries replaced. No GPU
// or downloaded assets are needed to verify lifecycle and crash scheduling.
function fixture() {
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const state = {
    disposed: false,
    ready: true,
    muted: false,
    presentationDirty: true,
    accumulatorS: 0,
    engine: { getDeltaTime: () => 1000 / 60, setHardwareScalingLevel: vi.fn() },
    scene: { render: vi.fn(), isReady: vi.fn(() => true) },
    simulation: new AutorooSimulation(22),
    input: new InputBuffer(),
    renderQuality: new AdaptiveRenderQuality({
      width: 402,
      height: 874,
      devicePixelRatio: 3,
    }),
    crashAnimation: new CrashAnimation(),
    audio: {
      setGameplayActive: vi.fn(),
      updateEngine: vi.fn(),
      play: vi.fn(),
      wake: vi.fn(),
    },
    callbacks: { onCrashAnimationComplete: vi.fn(), onEvent: vi.fn() },
    publish: vi.fn(),
    updateVisuals: vi.fn(),
  };
  const session = Object.assign(
    Object.create(BabylonGameSession.prototype),
    state,
  ) as typeof state & {
    frame(): void;
    setPaused(paused: boolean): void;
  };
  return session;
}

afterEach(() => vi.unstubAllGlobals());

describe('idle scene rendering', () => {
  it('draws a complete title frame once and retains it for subsequent RAF callbacks', () => {
    const session = fixture();
    for (let frame = 0; frame < 600; frame += 1) session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(1);
    expect(session.updateVisuals).toHaveBeenCalledTimes(1);
    expect(session.audio.updateEngine).toHaveBeenCalledTimes(1);
    session.presentationDirty = true;
    session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(2);
  });

  it('does not retain an incomplete frame while materials are compiling', () => {
    const session = fixture();
    session.scene.isReady.mockReturnValueOnce(false).mockReturnValueOnce(false);
    for (let frame = 0; frame < 20; frame += 1) session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(3);
  });

  it('keeps gameplay running and pauses/resumes without losing its final frame', () => {
    const session = fixture();
    session.simulation.start();
    for (let frame = 0; frame < 12; frame += 1) session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(12);
    session.setPaused(true);
    expect(session.audio.updateEngine).toHaveBeenLastCalledWith(
      session.simulation.renderPlayer.speedMps,
      false,
    );
    const tick = session.simulation.renderTick;
    for (let frame = 0; frame < 600; frame += 1) session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(13);
    expect(session.simulation.renderTick).toBe(tick);
    session.setPaused(false);
    session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(14);
    expect(session.simulation.renderTick).toBeGreaterThan(tick);
  });

  it('renders the entire crash and its completion once before idling', () => {
    const session = fixture();
    session.crashAnimation.start(
      {
        xM: 0,
        yM: 0,
        zM: 0,
        pitch: 0,
        yaw: 0,
        roll: 0,
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1,
      },
      1,
      false,
    );
    for (let frame = 0; frame < 120; frame += 1) session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(77);
    expect(session.callbacks.onCrashAnimationComplete).toHaveBeenCalledTimes(1);
    expect(session.crashAnimation.isPlaying).toBe(false);
    expect(session.crashAnimation.pose()).not.toBeNull();
    for (let frame = 0; frame < 120; frame += 1) session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(77);
  });

  it('does no scene work while hidden and retains invalidations for return', () => {
    const session = fixture();
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    session.frame();
    expect(session.scene.render).not.toHaveBeenCalled();
    expect(session.presentationDirty).toBe(true);
    vi.stubGlobal('document', { visibilityState: 'visible' });
    session.frame();
    expect(session.scene.render).toHaveBeenCalledTimes(1);
  });
});
