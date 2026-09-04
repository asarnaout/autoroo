import type { RunPhase } from './contracts';

export const SNAPSHOT_PUBLISH_INTERVAL_TICKS = 6;

/**
 * Regular HUD values publish at 10 Hz, but lifecycle transitions must never be
 * throttled: a game-over simulation stops ticking and would otherwise have no
 * later opportunity to deliver its final snapshot.
 */
export function shouldPublishRunSnapshot(
  force: boolean,
  tick: number,
  lastPublishedTick: number,
  phase: RunPhase,
  lastPublishedPhase: RunPhase | null,
): boolean {
  return (
    force ||
    phase !== lastPublishedPhase ||
    tick - lastPublishedTick >= SNAPSHOT_PUBLISH_INTERVAL_TICKS
  );
}
