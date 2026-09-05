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

  it('requires a warmup and two sustained slow windows before lowering resolution', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 359, 33.3);
    expect(quality.pixelRatio).toBe(3);
    quality.sample(33.3, true);
    expect(quality.pixelRatio).toBe(2.5);
    sampleFrames(quality, 120, 16.7);
    expect(quality.pixelRatio).toBe(2.5);
  });

  it('ignores model loading, paused tabs, and long resume stalls', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 1000, 60, false);
    expect(quality.pixelRatio).toBe(3);
    sampleFrames(quality, 359, 33.3);
    quality.sample(2000, true);
    sampleFrames(quality, 359, 33.3);
    expect(quality.pixelRatio).toBe(3);
  });

  it('walks the quality ladder and never falls below a CSS pixel per rendered pixel', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    for (const expected of [2.5, 2, 1.5, 1.25, 1, 1]) {
      sampleFrames(quality, 360, 33.3);
      expect(quality.pixelRatio).toBeCloseTo(expected);
      expect(quality.hardwareScalingLevel).toBeLessThanOrEqual(1);
    }
  });

  it('requires four stable fast windows before recovering one step', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 360, 33.3);
    sampleFrames(quality, 599, 16.7);
    expect(quality.pixelRatio).toBe(2.5);
    quality.sample(16.7, true);
    expect(quality.pixelRatio).toBe(3);
  });

  it('preserves quality across orientation and toolbar resizes, with a new settling window', () => {
    const quality = new AdaptiveRenderQuality(iphone);
    sampleFrames(quality, 360, 33.3);
    quality.resize({ ...iphone, width: 874, height: 402 });
    expect(quality.pixelRatio).toBe(2.5);
    quality.resize({ ...iphone, height: 740 });
    expect(quality.pixelRatio).toBe(2.5);
    sampleFrames(quality, 359, 33.3);
    expect(quality.pixelRatio).toBe(2.5);
    quality.sample(33.3, true);
    expect(quality.pixelRatio).toBe(2);
  });
});
