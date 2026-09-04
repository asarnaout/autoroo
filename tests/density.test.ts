import { describe, expect, it } from 'vitest';
import type { ChallengeCertificate } from '../app/game/contracts';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

type DensityBand = 'early' | 'mid' | 'late';

interface BandStats {
  obstacles: number;
  ordinaryRows: number;
  ordinaryBlockers: number;
  jumpGates: number;
  multiRowJumpGates: number;
  twoRowJumpGates: number;
  threeRowJumpGates: number;
  fourRowJumpGates: number;
  maxJumpRows: number;
  visibleSum: number;
  visibleSamples: number;
}

function makeStats(): Record<DensityBand, BandStats> {
  return {
    early: {
      obstacles: 0,
      ordinaryRows: 0,
      ordinaryBlockers: 0,
      jumpGates: 0,
      multiRowJumpGates: 0,
      twoRowJumpGates: 0,
      threeRowJumpGates: 0,
      fourRowJumpGates: 0,
      maxJumpRows: 0,
      visibleSum: 0,
      visibleSamples: 0,
    },
    mid: {
      obstacles: 0,
      ordinaryRows: 0,
      ordinaryBlockers: 0,
      jumpGates: 0,
      multiRowJumpGates: 0,
      twoRowJumpGates: 0,
      threeRowJumpGates: 0,
      fourRowJumpGates: 0,
      maxJumpRows: 0,
      visibleSum: 0,
      visibleSamples: 0,
    },
    late: {
      obstacles: 0,
      ordinaryRows: 0,
      ordinaryBlockers: 0,
      jumpGates: 0,
      multiRowJumpGates: 0,
      twoRowJumpGates: 0,
      threeRowJumpGates: 0,
      fourRowJumpGates: 0,
      maxJumpRows: 0,
      visibleSum: 0,
      visibleSamples: 0,
    },
  };
}

function densityBand(distanceM: number): DensityBand | null {
  if (distanceM >= 0 && distanceM < 1000) return 'early';
  if (distanceM >= 2000 && distanceM < 4000) return 'mid';
  if (distanceM >= 8000 && distanceM < 10_000) return 'late';
  return null;
}

function recordCertificate(
  stats: Record<DensityBand, BandStats>,
  certificate: ChallengeCertificate,
): number | null {
  const jumpRows =
    certificate.kind === 'jump'
      ? new Set(
          certificate.blockerTrajectories.map((trajectory) =>
            Math.round(trajectory.startZM * 1000),
          ),
        ).size
      : null;
  const band = densityBand(certificate.blockerTrajectories[0].startZM);
  if (!band) return jumpRows;

  stats[band].obstacles += certificate.blockerIds.length;
  if (certificate.kind === 'ground') {
    stats[band].ordinaryRows += 1;
    stats[band].ordinaryBlockers += certificate.blockerIds.length;
    return null;
  }

  stats[band].jumpGates += 1;
  if (jumpRows! > 1) stats[band].multiRowJumpGates += 1;
  if (jumpRows === 2) stats[band].twoRowJumpGates += 1;
  if (jumpRows === 3) stats[band].threeRowJumpGates += 1;
  if (jumpRows === 4) stats[band].fourRowJumpGates += 1;
  stats[band].maxJumpRows = Math.max(stats[band].maxJumpRows, jumpRows!);
  return jumpRows;
}

describe('progressive production traffic density', () => {
  it('starts readable, becomes busy quickly, and keeps every seeded route winnable', () => {
    const seeds = [
      0xa770_2026, 7, 19, 41, 71, 131, 211, 307, 401, 503, 601, 809,
    ];
    const aggregate = makeStats();
    const allJumpRows = [0, 0, 0, 0, 0];

    for (const seed of seeds) {
      const simulation = new AutorooSimulation(seed);
      const perSeed = makeStats();
      const seenCertificates = new Set<string>();
      let previousGroundLane = simulation.snapshot().player.lane;
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
          expect(
            Math.abs(certificate.targetLane - previousGroundLane),
          ).toBeLessThanOrEqual(1);
          previousGroundLane = certificate.targetLane;
          const jumpRows = recordCertificate(perSeed, certificate);
          if (jumpRows !== null) allJumpRows[jumpRows] += 1;
        }
        if (
          snapshot.activeCertificate &&
          !seenCertificates.has(snapshot.activeCertificate.id)
        ) {
          seenCertificates.add(snapshot.activeCertificate.id);
          const jumpRows = recordCertificate(
            perSeed,
            snapshot.activeCertificate,
          );
          if (jumpRows !== null) allJumpRows[jumpRows] += 1;
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

        const input = certificateBotInput(simulation, snapshot);
        simulation.tick(input);
        expect(
          simulation.phaseName,
          JSON.stringify({
            seed,
            step,
            zM: snapshot.player.absoluteZM,
            lane: snapshot.player.lane,
            input,
            activeCertificate: snapshot.activeCertificate?.id ?? null,
            nearby: snapshot.traffic
              .filter(
                (vehicle) =>
                  Math.abs(vehicle.absoluteZM - snapshot.player.absoluteZM) <
                  25,
              )
              .map((vehicle) => ({
                id: vehicle.id,
                encounterId: vehicle.encounterId,
                lane: vehicle.lane,
                zM: vehicle.absoluteZM,
                role: vehicle.role,
              })),
          }),
        ).toBe('running');
        simulation.drainEvents();
      }

      expect(simulation.renderPlayer.absoluteZM).toBeGreaterThanOrEqual(10_000);
      expect(perSeed.early.obstacles).toBeGreaterThanOrEqual(7);
      expect(perSeed.early.obstacles).toBeLessThanOrEqual(18);
      expect(perSeed.mid.obstacles / 2).toBeGreaterThanOrEqual(16);
      expect(perSeed.late.obstacles / 2).toBeGreaterThanOrEqual(16);

      for (const band of ['early', 'mid', 'late'] as const) {
        const source = perSeed[band];
        const target = aggregate[band];
        target.obstacles += source.obstacles;
        target.ordinaryRows += source.ordinaryRows;
        target.ordinaryBlockers += source.ordinaryBlockers;
        target.jumpGates += source.jumpGates;
        target.multiRowJumpGates += source.multiRowJumpGates;
        target.twoRowJumpGates += source.twoRowJumpGates;
        target.threeRowJumpGates += source.threeRowJumpGates;
        target.fourRowJumpGates += source.fourRowJumpGates;
        target.maxJumpRows = Math.max(target.maxJumpRows, source.maxJumpRows);
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

    expect(obstacleRate('mid', 2)).toBeGreaterThanOrEqual(22);
    expect(obstacleRate('mid', 2)).toBeGreaterThan(
      obstacleRate('early', 1) * 1.7,
    );
    expect(obstacleRate('late', 2)).toBeGreaterThanOrEqual(22);
    expect(obstacleRate('late', 2)).toBeGreaterThanOrEqual(
      obstacleRate('mid', 2) * 0.9,
    );
    expect(obstacleRate('late', 2)).toBeGreaterThan(
      obstacleRate('early', 1) * 1.75,
    );
    expect(blockersPerRow('early')).toBeGreaterThanOrEqual(1.4);
    expect(blockersPerRow('early')).toBeLessThanOrEqual(1.8);
    expect(blockersPerRow('mid')).toBeGreaterThanOrEqual(1.75);
    expect(blockersPerRow('late')).toBeGreaterThanOrEqual(1.55);
    expect(visibleMean('early')).toBeGreaterThanOrEqual(3.5);
    expect(visibleMean('early')).toBeLessThanOrEqual(5);
    expect(visibleMean('mid')).toBeGreaterThanOrEqual(7);
    expect(visibleMean('late')).toBeGreaterThanOrEqual(7);
    expect(visibleMean('mid')).toBeGreaterThan(visibleMean('early') * 1.5);
    expect(visibleMean('late')).toBeGreaterThanOrEqual(
      visibleMean('mid') * 0.9,
    );
    expect(
      aggregate.early.multiRowJumpGates +
        aggregate.mid.multiRowJumpGates +
        aggregate.late.multiRowJumpGates,
    ).toBeGreaterThanOrEqual(8);
    expect(allJumpRows[2]).toBeGreaterThanOrEqual(3);
    expect(allJumpRows[3]).toBeGreaterThanOrEqual(2);
    expect(allJumpRows[4]).toBeGreaterThanOrEqual(2);
    expect(
      Math.max(
        aggregate.early.maxJumpRows,
        aggregate.mid.maxJumpRows,
        aggregate.late.maxJumpRows,
      ),
    ).toBe(4);
  }, 30_000);
});
