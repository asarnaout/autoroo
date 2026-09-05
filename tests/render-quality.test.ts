import { describe, expect, it } from 'vitest';
import {
  AdaptiveRenderQuality,
  MAX_RENDER_PIXELS,
  renderPixelRatioLimit,
} from '../app/game/renderQuality';

const iphone = { width: 402, height: 874, devicePixelRatio: 3 };

function sampleFrames(
  quality: AdaptiveRenderQuality,
  frames: number,
  deltaMs: number,
  active = true,
): void {
  for (let index = 0; index < frames; index += 1)
    quality.sample(deltaMs, active);
}

describe('mobile rendering resolution', () => {
  it('renders a DPR 3 phone at native resolution rather than half CSS resolution', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    expect(quality.pixelRatio).toBe(3);
    expect(iphone.width / quality.hardwareScalingLevel).toBe(1206);
    expect(iphone.height / quality.hardwareScalingLevel).toBe(2622);
  });

  it('caps large retina viewports by pixel area while preserving CSS resolution', () => {
    const ratio = renderPixelRatioLimit({
      width: 1440,
      height: 900,
      devicePixelRatio: 2,
    });
    expect(1440 * 900 * ratio ** 2).toBeCloseTo(MAX_RENDER_PIXELS);
    expect(ratio).toBeGreaterThanOrEqual(1);
    expect(
      renderPixelRatioLimit({ width: 3840, height: 2160, devicePixelRatio: 2 }),
    ).toBe(1);
    expect(
      renderPixelRatioLimit({
        width: 0,
        height: 0,
        devicePixelRatio: Number.NaN,
      }),
    ).toBe(1);
  });

  it.each([30, 40, 50, 60, 120])(
    'keeps native resolution for two minutes at %i Hz',
    (hz) => {
      const quality = new AdaptiveRenderQuality(iphone);
      sampleFrames(quality, hz * 120, 1000 / hz);
      expect(quality.pixelRatio).toBe(3);
    },
  );

  it('tolerates normal 30 Hz scheduling jitter', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    for (let i = 0; i < 4000; i += 1) quality.sample(i % 2 ? 37 : 30, true);
    expect(quality.pixelRatio).toBe(3);
  });

  it('ignores one slow frame and interrupts consecutive overload windows', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 100, 1000 / 30);
    quality.sample(100, true);
    sampleFrames(quality, 100, 1000 / 30);
    expect(quality.pixelRatio).toBe(3);
    const consecutive = new AdaptiveRenderQuality(iphone);
    sampleFrames(consecutive, 80, 50); // Warmup and one overloaded window.
    sampleFrames(consecutive, 100, 20); // A healthy window breaks the streak.
    sampleFrames(consecutive, 40, 50);
    expect(consecutive.pixelRatio).toBe(3);
    sampleFrames(consecutive, 40, 50);
    expect(consecutive.pixelRatio).toBe(2.5);
  });

  it.each([60, 120])('restores quality in about ten seconds at %i Hz', (hz) => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 120, 50);
    sampleFrames(quality, hz * 9, 1000 / hz);
    expect(quality.pixelRatio).toBe(2.5);
    sampleFrames(quality, Math.ceil(hz * 1.2), 1000 / hz);
    expect(quality.pixelRatio).toBe(3);
  });

  it('requires six seconds of sustained overload before the first reduction', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 119, 50);
    expect(quality.pixelRatio).toBe(3);
    quality.sample(50, true);
    expect(quality.pixelRatio).toBe(2.5);
  });

  it('retains a retina sharpness floor even under extended overload', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 2400, 50);
    expect(quality.pixelRatio).toBe(2);
    expect(iphone.width / quality.hardwareScalingLevel).toBe(804);
  });

  it('recovers under a stable 30 Hz cap after four healthy windows', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 240, 50);
    expect(quality.pixelRatio).toBe(2);
    sampleFrames(quality, 290, 1000 / 30);
    expect(quality.pixelRatio).toBe(2);
    sampleFrames(quality, 20, 1000 / 30);
    expect(quality.pixelRatio).toBe(2.5);
    sampleFrames(quality, 310, 1000 / 30);
    expect(quality.pixelRatio).toBe(3);
  });

  it('ignores loading, pause, isolated stalls and invalid samples', () => {
    for (const interruption of [NaN, 0, -1, 2000]) {
      const quality = new AdaptiveRenderQuality(iphone);
      sampleFrames(quality, 1000, 60, false);
      sampleFrames(quality, 119, 50);
      quality.sample(interruption, true);
      sampleFrames(quality, 119, 50);
      expect(quality.pixelRatio).toBe(3);
    }
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 119, 50);
    quality.sample(50, false);
    sampleFrames(quality, 119, 50);
    expect(quality.pixelRatio).toBe(3);
  });

  it('preserves quality during rotation and settles before adapting again', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 120, 50);
    quality.resize({ ...iphone, width: 874, height: 402 });
    expect(quality.pixelRatio).toBe(2.5);
    sampleFrames(quality, 119, 50);
    expect(quality.pixelRatio).toBe(2.5);
    quality.sample(50, true);
    expect(quality.pixelRatio).toBe(2);
  });

  it('does not let duplicate resize notifications prevent recovery', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 240, 50);
    for (let i = 0; i < 1300; i += 1) {
      expect(quality.resize(iphone)).toBe(false);
      quality.sample(1000 / 60, true);
    }
    expect(quality.pixelRatio).toBe(3);
  });

  it('respects native DPR, pixel budget and sharpness floor after resizing', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 2400, 50);
    const desktop = { width: 1440, height: 900, devicePixelRatio: 2 };
    quality.resize(desktop);
    expect(quality.pixelRatio).toBe(renderPixelRatioLimit(desktop));
    quality.resize({ ...iphone, devicePixelRatio: 1 });
    sampleFrames(quality, 2400, 50);
    expect(quality.pixelRatio).toBe(1);
    quality.resize(iphone);
    expect(quality.pixelRatio).toBeGreaterThanOrEqual(2);
    expect(quality.pixelRatio).toBeLessThanOrEqual(3);
  });
});
