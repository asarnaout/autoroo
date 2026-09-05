/** Bound GPU work while retaining a native-size framebuffer on modern phones. */
export const MAX_RENDER_PIXELS = 3_500_000;
export const RENDER_PIXEL_RATIO_STEPS = [3, 2.5, 2, 1.5, 1.25, 1] as const;

export interface RenderViewport {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function renderPixelRatioLimit(viewport: RenderViewport): number {
  const width = finitePositive(viewport.width, 1);
  const height = finitePositive(viewport.height, 1);
  const deviceRatio = finitePositive(viewport.devicePixelRatio, 1);
  // A CSS-pixel floor is intentional: even a very large viewport must never
  // repeat the old mobile failure of stretching a half-size framebuffer.
  return Math.max(
    1,
    Math.min(deviceRatio, 3, Math.sqrt(MAX_RENDER_PIXELS / (width * height))),
  );
}

const WINDOW_MS = 2000;
const WARMUP_MS = 2000;
// RAF cadence includes browser scheduling, not just GPU work. In particular,
// iOS may cap a healthy session at 30 Hz. Keep that cadence sharp and allow
// recovery at 30 Hz instead of repeatedly shrinking an unchanged workload.
const SLOW_WINDOW_MS = 40;
const FAST_WINDOW_MS = 35;
const SLOW_WINDOWS_TO_REDUCE = 2;
const FAST_WINDOWS_TO_RESTORE = 4;
const RATIO_EPSILON = 0.001;

/**
 * Sample only after loading, while running, and while the page is visible.
 * The caller applies hardwareScalingLevel only when resize/sample returns true.
 */
export class AdaptiveRenderQuality {
  private maximumRatio: number;
  private qualityFactor = 1;
  private warmupMs = WARMUP_MS;
  private viewport: RenderViewport;
  private sampleFrames = 0;
  private sampleTotalMs = 0;
  private slowWindows = 0;
  private fastWindows = 0;

  constructor(viewport: RenderViewport) {
    this.maximumRatio = renderPixelRatioLimit(viewport);
    this.viewport = { ...viewport };
  }

  get pixelRatio(): number {
    return Math.max(this.minimumRatio, this.maximumRatio * this.qualityFactor);
  }

  private get minimumRatio(): number {
    // Preserve at least two rendered pixels per CSS pixel on retina screens,
    // unless the native DPR or the absolute pixel budget is already lower.
    return Math.min(this.maximumRatio, 2);
  }

  /** Babylon divides CSS dimensions by this value; higher DPR needs < 1. */
  get hardwareScalingLevel(): number {
    return 1 / this.pixelRatio;
  }

  resize(viewport: RenderViewport): boolean {
    if (
      viewport.width === this.viewport.width &&
      viewport.height === this.viewport.height &&
      viewport.devicePixelRatio === this.viewport.devicePixelRatio
    )
      return false;
    this.viewport = { ...viewport };
    const previous = this.pixelRatio;
    this.maximumRatio = renderPixelRatioLimit(viewport);
    // Keep the earned quality factor across orientation / browser toolbar
    // changes instead of resetting to a blurry default or maximum GPU load.
    this.qualityFactor = this.pixelRatio / this.maximumRatio;
    this.resetSamples();
    return Math.abs(previous - this.pixelRatio) > RATIO_EPSILON;
  }

  sample(deltaMs: number, active: boolean): boolean {
    if (!active || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 100) {
      this.resetSamples();
      return false;
    }
    if (this.warmupMs > 0) {
      this.warmupMs -= deltaMs;
      return false;
    }
    this.sampleFrames += 1;
    this.sampleTotalMs += deltaMs;
    if (this.sampleTotalMs < WINDOW_MS) return false;

    const averageMs = this.sampleTotalMs / this.sampleFrames;
    this.sampleFrames = 0;
    this.sampleTotalMs = 0;
    if (averageMs > SLOW_WINDOW_MS) {
      this.slowWindows += 1;
      this.fastWindows = 0;
    } else if (averageMs < FAST_WINDOW_MS) {
      this.fastWindows += 1;
      this.slowWindows = 0;
    } else {
      this.slowWindows = 0;
      this.fastWindows = 0;
    }

    const current = this.pixelRatio;
    let next = current;
    if (this.slowWindows >= SLOW_WINDOWS_TO_REDUCE) {
      next =
        RENDER_PIXEL_RATIO_STEPS.find(
          (ratio) => ratio < current - RATIO_EPSILON,
        ) ?? 1;
    } else if (this.fastWindows >= FAST_WINDOWS_TO_RESTORE) {
      const higherSteps = RENDER_PIXEL_RATIO_STEPS.filter(
        (ratio) => ratio > current + RATIO_EPSILON && ratio < this.maximumRatio,
      );
      next = higherSteps.at(-1) ?? this.maximumRatio;
    }
    next = Math.max(this.minimumRatio, Math.min(this.maximumRatio, next));
    if (Math.abs(next - current) <= RATIO_EPSILON) return false;
    this.qualityFactor = next / this.maximumRatio;
    this.resetSamples();
    return true;
  }

  private resetSamples(): void {
    this.sampleFrames = 0;
    this.sampleTotalMs = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.warmupMs = WARMUP_MS;
  }
}
