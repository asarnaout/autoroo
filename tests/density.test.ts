import { describe, expect, it } from 'vitest';
import type { ChallengeCertificate } from '../app/game/contracts';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

type DensityBand = 'early' | 'mid' | 'late';

interface BandStats {
  obstacles: number;
  ordinaryRows: number;
  ordinaryBlockers: number;
  visibleSum: number;
  visibleSamples: number;
}

function makeStats(): Record<DensityBand, BandStats> {
  return {
    early: {
      obstacles: 0,
      ordinaryRows: 0,
      ordinaryBlockers: 0,
      visibleSum: 0,
      visibleSamples: 0,
    },
    mid: {
      obstacles: 0,
      ordinaryRows: 0,
      ordinaryBlockers: 0,
      visibleSum: 0,
      visibleSamples: 0,
    },
    late: {
      obstacles: 0,
      ordinaryRows: 0,
      ordinaryBlockers: 0,
      visibleSum: 0,
      visibleSamples: 0,
    },
  };
}

function densityBand(distanceM: number): DensityBand | null {
  if (distanceM >= 0 && distanceM < 1000) return 'early';
  if (distanceM >= 1000 && distanceM < 4000) return 'mid';
  if (distanceM >= 6000 && distanceM < 10_000) return 'late';
  return null;
}

function recordCertificate(
  stats: Record<DensityBand, BandStats>,
  certificate: ChallengeCertificate,
): void {
  const band = densityBand(certificate.blockerTrajectories[0].startZM);
  if (!band) return;
  stats[band].obstacles += certificate.blockerIds.length;
  if (certificate.kind === 'ground') {
    stats[band].ordinaryRows += 1;
    stats[band].ordinaryBlockers += certificate.blockerIds.length;
  }
}

describe('progressive production traffic density', () => {
  it('starts readable, becomes busy quickly, and keeps every seeded route winnable', () => {
    const seeds = [0xa770_2026, 7, 19, 41, 71, 131];
    const aggregate = makeStats();

    for (const seed of seeds) {
      const simulation = new AutorooSimulation(seed);
      const perSeed = makeStats();
      const seenCertificates = new Set<string>();
      let nextVisibilitySampleM = 100;
      simulation.start();

      for (
        let step = 0;
        step < 25_000 && simulation.renderPlayer.absoluteZM < 10_000;
        step += 1
      ) {
        const snapshot = simulation.snapshot();
        for (const certificate of simulation.getGroundCertificates()) {
          if (seenCertificates.has(certificate.id)) continue;
          seenCertificates.add(certificate.id);
          recordCertificate(perSeed, certificate);
        }
        if (
          snapshot.activeCertificate &&
          !seenCertificates.has(snapshot.activeCertificate.id)
        ) {
          seenCertificates.add(snapshot.activeCertificate.id);
          recordCertificate(perSeed, snapshot.activeCertificate);
        }

        while (snapshot.player.absoluteZM >= nextVisibilitySampleM) {
          const band = densityBand(nextVisibilitySampleM);
          if (band) {
            const visible = snapshot.traffic.filter(
              (vehicle) =>
                vehicle.role !== 'rear-pressure' &&
                vehicle.absoluteZM > snapshot.player.absoluteZM &&
                vehicle.absoluteZM <= snapshot.player.absoluteZM + 260,
            ).length;
            perSeed[band].visibleSum += visible;
            perSeed[band].visibleSamples += 1;
          }
          nextVisibilitySampleM += 100;
        }

        simulation.tick(certificateBotInput(simulation, snapshot));
        expect(simulation.phaseName).toBe('running');
        simulation.drainEvents();
      }

      expect(simulation.renderPlayer.absoluteZM).toBeGreaterThanOrEqual(10_000);
      expect(perSeed.early.obstacles).toBeGreaterThanOrEqual(3);
      expect(perSeed.early.obstacles).toBeLessThanOrEqual(9);
      expect(perSeed.mid.obstacles / 3).toBeGreaterThanOrEqual(11);
      expect(perSeed.late.obstacles / 4).toBeGreaterThanOrEqual(10);

      for (const band of ['early', 'mid', 'late'] as const) {
        const source = perSeed[band];
        const target = aggregate[band];
        target.obstacles += source.obstacles;
        target.ordinaryRows += source.ordinaryRows;
        target.ordinaryBlockers += source.ordinaryBlockers;
        target.visibleSum += source.visibleSum;
        target.visibleSamples += source.visibleSamples;
      }
    }

    const obstacleRate = (band: DensityBand, lengthKm: number) =>
      aggregate[band].obstacles / seeds.length / lengthKm;
    const blockersPerRow = (band: DensityBand) =>
      aggregate[band].ordinaryBlockers / aggregate[band].ordinaryRows;
    const visibleMean = (band: DensityBand) =>
      aggregate[band].visibleSum / aggregate[band].visibleSamples;

    expect(obstacleRate('mid', 3)).toBeGreaterThanOrEqual(14);
    expect(obstacleRate('mid', 3)).toBeGreaterThan(
      obstacleRate('early', 1) * 1.7,
    );
    expect(obstacleRate('late', 4)).toBeGreaterThanOrEqual(14);
    expect(obstacleRate('late', 4)).toBeGreaterThan(
      obstacleRate('early', 1) * 1.6,
    );
    expect(blockersPerRow('early')).toBeLessThanOrEqual(1.15);
    expect(blockersPerRow('mid')).toBeGreaterThanOrEqual(1.5);
    expect(blockersPerRow('late')).toBeGreaterThanOrEqual(1.8);
    expect(visibleMean('mid')).toBeGreaterThanOrEqual(3.8);
    expect(visibleMean('late')).toBeGreaterThanOrEqual(3.8);
    expect(visibleMean('mid')).toBeGreaterThan(visibleMean('early') * 2);
    expect(visibleMean('late')).toBeGreaterThan(visibleMean('early') * 1.7);
  }, 30_000);
});
