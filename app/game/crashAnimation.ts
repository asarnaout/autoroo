export const CRASH_LANDING_S = 0.91;
export const CRASH_DURATION_S = 1.28;
const REDUCED_CRASH_DURATION_S = 0.4;

export interface CrashPose {
  readonly xM: number;
  readonly yM: number;
  readonly zM: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly scaleZ: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const shortestAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

/** Presentation clock only: the simulation and final score stop on impact. */
export class CrashAnimation {
  private initial: CrashPose | null = null;
  private elapsedS = 0;
  private direction = 1;
  private reducedMotion = false;

  start(initial: CrashPose, direction: -1 | 1, reducedMotion: boolean): void {
    this.initial = {
      ...initial,
      pitch: shortestAngle(initial.pitch),
      roll: shortestAngle(initial.roll),
    };
    this.elapsedS = 0;
    this.direction = direction;
    this.reducedMotion = reducedMotion;
  }

  reset(): void {
    this.initial = null;
    this.elapsedS = 0;
  }

  /** True exactly once, on the frame that finishes the reaction. */
  advance(deltaS: number): boolean {
    if (!this.initial || !Number.isFinite(deltaS)) return false;
    const duration = this.reducedMotion
      ? REDUCED_CRASH_DURATION_S
      : CRASH_DURATION_S;
    const wasPlaying = this.elapsedS < duration;
    this.elapsedS = Math.min(duration, this.elapsedS + Math.max(0, deltaS));
    return wasPlaying && this.elapsedS >= duration;
  }

  pose(): CrashPose | null {
    const base = this.initial;
    if (!base) return null;
    const t = this.elapsedS;
    if (this.reducedMotion) {
      const p = smooth(t / REDUCED_CRASH_DURATION_S);
      const squash = Math.sin(p * Math.PI) * 0.1;
      return {
        xM: base.xM,
        yM: base.yM * (1 - p),
        zM: -0.2 * p,
        pitch: base.pitch * (1 - p),
        yaw: base.yaw * (1 - p),
        roll: base.roll * (1 - p),
        scaleX: 1 + (base.scaleX - 1) * (1 - p) + squash * 0.5,
        scaleY: 1 + (base.scaleY - 1) * (1 - p),
        scaleZ: 1 + (base.scaleZ - 1) * (1 - p) - squash,
      };
    }

    const impact = t < 0.16 ? Math.sin((t / 0.16) * Math.PI) : 0;
    const hop = clamp01((t - 0.12) / (CRASH_LANDING_S - 0.12));
    const travel = smooth(hop);
    const initialWeight = 1 - smooth(hop / 0.4);
    const settle = clamp01(
      (t - CRASH_LANDING_S) / (CRASH_DURATION_S - CRASH_LANDING_S),
    );
    const wobble = Math.sin(settle * Math.PI * 4) * (1 - settle) ** 2;
    const pitch = base.pitch * initialWeight - Math.PI * 2 * travel;
    const roll =
      base.roll * initialWeight +
      this.direction * (0.32 * Math.sin(hop * Math.PI) + 0.14 * wobble);
    // A conservative car-sized envelope keeps the cartwheel above the road.
    const clearance =
      Math.max(
        0,
        Math.abs(Math.sin(pitch)) * 2.6 + Math.abs(Math.sin(roll)) * 1.08 - 0.5,
      ) * smooth(hop / 0.12);
    return {
      xM: base.xM + this.direction * 0.55 * travel,
      yM: Math.max(
        base.yM * (1 - travel) + 2.8 * 4 * hop * (1 - hop),
        clearance,
      ),
      zM: -1.9 * travel,
      pitch,
      yaw:
        base.yaw * initialWeight +
        this.direction * (0.95 * travel + 0.08 * wobble),
      roll,
      scaleX:
        1 + (base.scaleX - 1) * initialWeight + impact * 0.22 - wobble * 0.04,
      scaleY:
        1 + (base.scaleY - 1) * initialWeight + impact * 0.15 + wobble * 0.09,
      scaleZ:
        1 + (base.scaleZ - 1) * initialWeight - impact * 0.44 - wobble * 0.04,
    };
  }
}
