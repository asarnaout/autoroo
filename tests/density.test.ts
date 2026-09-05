import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  TRAFFIC_PREGEN_AHEAD_M,
  TRAFFIC_RENDER_AHEAD_M,
} from '../app/game/constants';
import type { ChallengeCertificate, LaneIndex } from '../app/game/contracts';
import { laneMaskAt } from '../app/game/generator';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

interface ManeuverPlanRow {
  readonly offsetM: number;
  readonly blockedLaneMask: number;
  readonly action: 'jump' | 'dodge';
  readonly targetLane: LaneIndex;
}

type CertificateWithManeuverPlan = ChallengeCertificate & {
  readonly maneuverPlan?: readonly ManeuverPlanRow[];
};

function maneuverPlan(
  certificate: ChallengeCertificate,
): readonly ManeuverPlanRow[] {
  return (certificate as CertificateWithManeuverPlan).maneuverPlan ?? [];
}

function uniqueRowStarts(certificate: ChallengeCertificate): number[] {
  return [
    ...new Set(
      certificate.blockerTrajectories.map(
        (trajectory) => Math.round(trajectory.startZM * 1000) / 1000,
      ),
    ),
  ].sort((first, second) => first - second);
}

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((first, second) => first - second);
  return ordered[Math.floor((ordered.length - 1) * fraction)] ?? 0;
}

function assertLongMixedChallenge(
  seed: number,
  certificate: ChallengeCertificate,
): void {
  const plan = [...maneuverPlan(certificate)].sort(
    (first, second) => first.offsetM - second.offsetM,
  );
  const jumpRows = plan.filter((row) => row.action === 'jump');
  const dodgeRows = plan.filter((row) => row.action === 'dodge');
  const rowGaps = plan
    .slice(1)
    .map((row, index) => row.offsetM - plan[index].offsetM);
  const actionChanges = plan
    .slice(1)
    .filter((row, index) => row.action !== plan[index].action).length;
  const dodgeTargets = dodgeRows.map((row) => row.targetLane);
  const dodgeLaneChanges = dodgeTargets
    .slice(1)
    .filter((lane, index) => lane !== dodgeTargets[index]).length;
  const firstRowStartM = Math.min(
    ...certificate.blockerTrajectories.map((trajectory) => trajectory.startZM),
  );

  expect(plan.length, certificate.id).toBeGreaterThanOrEqual(20);
  expect(jumpRows.length, certificate.id).toBeGreaterThanOrEqual(3);
  expect(dodgeRows.length, certificate.id).toBeGreaterThanOrEqual(17);
  expect(
    plan.at(-1)!.offsetM - plan[0].offsetM,
    certificate.id,
  ).toBeGreaterThanOrEqual(285);
  expect(Math.max(...rowGaps), certificate.id).toBeLessThanOrEqual(18);
  expect(actionChanges, certificate.id).toBeGreaterThanOrEqual(3);
  expect(new Set(dodgeTargets).size, certificate.id).toBeGreaterThanOrEqual(2);
  expect(dodgeLaneChanges, certificate.id).toBeGreaterThanOrEqual(2);
  for (const row of plan) {
    const rowStartM = firstRowStartM + row.offsetM;
    const activeMask = laneMaskAt(seed, rowStartM);
    const actualBlockedMask = certificate.blockerTrajectories
      .filter((trajectory) => Math.abs(trajectory.startZM - rowStartM) < 0.001)
      .reduce((mask, trajectory) => mask | (1 << trajectory.lane), 0);
    expect(row.blockedLaneMask, certificate.id).toBe(actualBlockedMask);
    expect(row.blockedLaneMask & ~activeMask, certificate.id).toBe(0);
    expect(activeMask & (1 << row.targetLane), certificate.id).not.toBe(0);
    if (row.action === 'jump') {
      expect(row.blockedLaneMask, certificate.id).toBe(activeMask);
    } else {
      expect(row.blockedLaneMask, certificate.id).not.toBe(activeMask);
      expect(row.blockedLaneMask & (1 << row.targetLane), certificate.id).toBe(
        0,
      );
    }
  }
  expect(
    certificate.witness.some((point) => point.input.jumpPressed),
    `${certificate.id} must prove a jump`,
  ).toBe(true);
  expect(
    certificate.witness.some((point) => point.input.laneDelta !== 0),
    `${certificate.id} must prove a lane change`,
  ).toBe(true);
}

function isMixedChallenge(certificate: ChallengeCertificate): boolean {
  const actions = new Set(maneuverPlan(certificate).map((row) => row.action));
  return actions.has('jump') && actions.has('dodge');
}

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
  it('keeps the traffic generation frontier behind the render boundary', () => {
    expect(TRAFFIC_PREGEN_AHEAD_M).toBeGreaterThan(TRAFFIC_RENDER_AHEAD_M);
  });

  it('stays continuously busy and produces long mixed maneuver chains', () => {
    const seeds = [
      0xa770_2026, 7, 19, 41, 71, 131, 211, 307, 401, 503, 601, 809,
    ];
    const aggregate = makeStats();

    for (const seed of seeds) {
      const simulation = new AutorooSimulation(seed);
      const perSeed = makeStats();
      const seenCertificates = new Set<string>();
      const lateRowStartsM = new Set<number>();
      const lateLiveRowGapsM: number[] = [];
      const mixedChallengeStartsM: number[] = [];
      const seenTrafficIds = new Set(
        simulation.snapshot().traffic.map((vehicle) => vehicle.id),
      );
      let previousGroundLane = simulation.snapshot().player.lane;
      let previousGroundZM = Number.NEGATIVE_INFINITY;
      let nextVisibilitySampleM = 100;
      let emptyRoadTicks = 0;
      let maxEmptyRoadTicks = 0;
      let maneuverLullTicks = 0;
      let maxManeuverLullTicks = 0;
      let lateTicks = 0;
      let lateVisibleTicks = 0;
      let completedMixedChallenges = 0;
      let previousActiveCertificateId: string | null = null;
      let firstMixedStartM = Number.POSITIVE_INFINITY;
      simulation.start();

      for (
        let step = 0;
        step < 25_000 && simulation.renderPlayer.absoluteZM < 10_000;
        step += 1
      ) {
        const snapshot = simulation.snapshot();
        for (const vehicle of snapshot.traffic) {
          if (seenTrafficIds.has(vehicle.id)) continue;
          seenTrafficIds.add(vehicle.id);
          expect(
            vehicle.absoluteZM - snapshot.player.absoluteZM,
            `${vehicle.id} was born inside the visible scene for seed ${seed}`,
          ).toBeGreaterThan(TRAFFIC_RENDER_AHEAD_M);
        }
        for (const certificate of simulation.getGroundCertificates()) {
          if (seenCertificates.has(certificate.id)) continue;
          const isRendered = snapshot.traffic.some(
            (vehicle) =>
              vehicle.certificateId === certificate.id &&
              vehicle.absoluteZM - snapshot.player.absoluteZM <=
                TRAFFIC_RENDER_AHEAD_M,
          );
          if (!isRendered) continue;
          seenCertificates.add(certificate.id);
          const certificateZM = certificate.blockerTrajectories[0].startZM;
          if (certificateZM - previousGroundZM < 150) {
            expect(
              Math.abs(certificate.targetLane - previousGroundLane),
              `${seed}:${certificate.id}:${previousGroundLane}->${certificate.targetLane}:${previousGroundZM}->${certificateZM}`,
            ).toBeLessThanOrEqual(1);
          }
          previousGroundLane = certificate.targetLane;
          previousGroundZM = certificateZM;
          recordCertificate(perSeed, certificate);
          for (const rowStartM of uniqueRowStarts(certificate)) {
            if (rowStartM >= 2000 && rowStartM < 10_000)
              lateRowStartsM.add(rowStartM);
          }
        }
        if (
          snapshot.activeCertificate &&
          !seenCertificates.has(snapshot.activeCertificate.id)
        ) {
          const certificate = snapshot.activeCertificate;
          seenCertificates.add(certificate.id);
          recordCertificate(perSeed, certificate);
          for (const rowStartM of uniqueRowStarts(certificate)) {
            if (rowStartM >= 2000 && rowStartM < 10_000)
              lateRowStartsM.add(rowStartM);
          }
          const actions = new Set(
            maneuverPlan(certificate).map((row) => row.action),
          );
          if (actions.has('jump') && actions.has('dodge')) {
            assertLongMixedChallenge(seed, certificate);
            for (const route of certificate.approachRoutes) {
              const groundCertificate = simulation
                .getGroundCertificates()
                .find((candidate) =>
                  candidate.blockerTrajectories.some(
                    (trajectory) =>
                      trajectory.encounterId === route.encounterId,
                  ),
                );
              expect(groundCertificate, route.encounterId).toBeDefined();
              expect(
                groundCertificate!.revealTick,
                route.encounterId,
              ).toBeLessThan(certificate.revealTick);
            }
            const startM = uniqueRowStarts(certificate)[0];
            firstMixedStartM = Math.min(firstMixedStartM, startM);
            if (startM >= 2000 && startM < 10_000)
              mixedChallengeStartsM.push(startM);
          }
        }

        if (snapshot.activeCertificate) {
          previousActiveCertificateId = snapshot.activeCertificate.id;
        } else if (previousActiveCertificateId !== null) {
          const continuationRowsM = [
            ...new Map(
              snapshot.traffic
                .filter(
                  (vehicle) =>
                    vehicle.role === 'ordinary' &&
                    vehicle.absoluteZM > snapshot.player.absoluteZM,
                )
                .map((vehicle) => [
                  vehicle.encounterId,
                  vehicle.absoluteZM - snapshot.player.absoluteZM,
                ]),
            ).values(),
          ].sort((first, second) => first - second);
          expect(
            continuationRowsM[0],
            `${previousActiveCertificateId} ended without close continuation traffic`,
          ).toBeLessThanOrEqual(75);
          expect(
            continuationRowsM.filter((leadM) => leadM <= 200).length,
            `${previousActiveCertificateId} ended without a sustained continuation`,
          ).toBeGreaterThanOrEqual(4);
          const firstFourGapsM = continuationRowsM
            .slice(1, 4)
            .map((leadM, index) => leadM - continuationRowsM[index]);
          expect(
            Math.max(...firstFourGapsM),
            `${previousActiveCertificateId} continuation rows spread apart`,
          ).toBeLessThanOrEqual(48);
          completedMixedChallenges += 1;
          previousActiveCertificateId = null;
        }

        const visibleObstacle = snapshot.traffic.some(
          (vehicle) =>
            vehicle.absoluteZM > snapshot.player.absoluteZM &&
            vehicle.absoluteZM <= snapshot.player.absoluteZM + 260,
        );
        if (snapshot.player.absoluteZM >= 500) {
          if (visibleObstacle) {
            maxEmptyRoadTicks = Math.max(maxEmptyRoadTicks, emptyRoadTicks);
            emptyRoadTicks = 0;
          } else {
            emptyRoadTicks += 1;
          }
        }
        if (snapshot.player.absoluteZM >= 2000) {
          lateTicks += 1;
          if (visibleObstacle) lateVisibleTicks += 1;
          if (step % 30 === 0) {
            const liveRowsM = [
              ...new Map(
                snapshot.traffic
                  .filter(
                    (vehicle) =>
                      vehicle.absoluteZM > snapshot.player.absoluteZM &&
                      vehicle.absoluteZM <= snapshot.player.absoluteZM + 260,
                  )
                  .map((vehicle) => [vehicle.encounterId, vehicle.absoluteZM]),
              ).values(),
            ].sort((first, second) => first - second);
            if (liveRowsM.length > 1) {
              lateLiveRowGapsM.push(
                ...liveRowsM
                  .slice(1)
                  .map((rowM, index) => rowM - liveRowsM[index]),
              );
            }
          }
        }

        while (snapshot.player.absoluteZM >= nextVisibilitySampleM) {
          const band = densityBand(nextVisibilitySampleM);
          if (band) {
            const visible = snapshot.traffic.filter(
              (vehicle) =>
                vehicle.absoluteZM > snapshot.player.absoluteZM &&
                vehicle.absoluteZM <= snapshot.player.absoluteZM + 260,
            ).length;
            perSeed[band].visibleSum += visible;
            perSeed[band].visibleSamples += 1;
          }
          nextVisibilitySampleM += 100;
        }

        const input = certificateBotInput(simulation, snapshot);
        const mixedChainActive =
          snapshot.activeCertificate !== null &&
          isMixedChallenge(snapshot.activeCertificate);
        const immediateTrafficPressure = snapshot.traffic.some(
          (vehicle) =>
            vehicle.absoluteZM > snapshot.player.absoluteZM &&
            vehicle.absoluteZM <= snapshot.player.absoluteZM + 230,
        );
        const wasAirborne = snapshot.player.airborne;
        simulation.tick(input);
        if (snapshot.player.absoluteZM >= 2000) {
          const jumpStarted = !wasAirborne && simulation.renderPlayer.airborne;
          if (
            input.laneDelta !== 0 ||
            jumpStarted ||
            mixedChainActive ||
            immediateTrafficPressure
          ) {
            maxManeuverLullTicks = Math.max(
              maxManeuverLullTicks,
              maneuverLullTicks,
            );
            maneuverLullTicks = 0;
          } else {
            maneuverLullTicks += 1;
          }
        }
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
      expect(completedMixedChallenges, `seed ${seed}`).toBeGreaterThanOrEqual(
        4,
      );
      expect(firstMixedStartM, `seed ${seed}`).toBeLessThanOrEqual(2000);
      maxEmptyRoadTicks = Math.max(maxEmptyRoadTicks, emptyRoadTicks);
      maxManeuverLullTicks = Math.max(maxManeuverLullTicks, maneuverLullTicks);
      expect(maxEmptyRoadTicks * FIXED_DT, `seed ${seed}`).toBeLessThanOrEqual(
        1.5,
      );
      expect(
        lateVisibleTicks / lateTicks,
        `seed ${seed}`,
      ).toBeGreaterThanOrEqual(0.98);
      // Pre-generated rows deliberately become visible before the route bot
      // must react. Treat nearby committed traffic as pressure as well as an
      // active maneuver, rather than misclassifying that look-ahead as a lull.
      expect(
        maxManeuverLullTicks * FIXED_DT,
        `seed ${seed}`,
      ).toBeLessThanOrEqual(3);

      const lateRows = [...lateRowStartsM].sort(
        (first, second) => first - second,
      );
      expect(lateRows.length, `seed ${seed}`).toBeGreaterThanOrEqual(160);
      // `startZM` values come from different reveal ticks; moving traffic can
      // advance several metres before the following row is drafted. Measure
      // live row-to-row gaps, while the independent empty-road checks cover the
      // distance from the player to the first visible row.
      expect(
        percentile(lateLiveRowGapsM, 0.9),
        `seed ${seed}`,
      ).toBeLessThanOrEqual(42);
      expect(Math.max(...lateLiveRowGapsM), `seed ${seed}`).toBeLessThanOrEqual(
        195,
      );

      mixedChallengeStartsM.sort((first, second) => first - second);
      expect(
        mixedChallengeStartsM.length,
        `seed ${seed}`,
      ).toBeGreaterThanOrEqual(4);
      if (mixedChallengeStartsM.length > 0) {
        const mixedCoverageGapsM = [
          mixedChallengeStartsM[0] - 2000,
          ...mixedChallengeStartsM
            .slice(1)
            .map((startM, index) => startM - mixedChallengeStartsM[index]),
          10_000 - mixedChallengeStartsM.at(-1)!,
        ];
        expect(
          Math.max(...mixedCoverageGapsM),
          `seed ${seed}`,
        ).toBeLessThanOrEqual(3000);
      }
      expect(perSeed.early.obstacles).toBeGreaterThanOrEqual(10);
      expect(perSeed.mid.obstacles / 2).toBeGreaterThanOrEqual(25);
      expect(perSeed.late.obstacles / 2).toBeGreaterThanOrEqual(25);

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

    expect(obstacleRate('mid', 2)).toBeGreaterThanOrEqual(35);
    expect(obstacleRate('mid', 2)).toBeGreaterThan(
      obstacleRate('early', 1) * 1.25,
    );
    expect(obstacleRate('late', 2)).toBeGreaterThanOrEqual(35);
    expect(obstacleRate('late', 2)).toBeGreaterThanOrEqual(
      obstacleRate('mid', 2) * 0.9,
    );
    expect(obstacleRate('late', 2)).toBeGreaterThan(
      obstacleRate('early', 1) * 1.25,
    );
    expect(blockersPerRow('early')).toBeGreaterThanOrEqual(1.4);
    expect(blockersPerRow('early')).toBeLessThanOrEqual(1.8);
    expect(blockersPerRow('mid')).toBeGreaterThanOrEqual(1.75);
    expect(blockersPerRow('late')).toBeGreaterThanOrEqual(1.55);
    expect(visibleMean('early')).toBeGreaterThanOrEqual(5);
    expect(visibleMean('mid')).toBeGreaterThanOrEqual(8);
    expect(visibleMean('late')).toBeGreaterThanOrEqual(8);
    expect(visibleMean('mid')).toBeGreaterThan(visibleMean('early') * 1.15);
    expect(visibleMean('late')).toBeGreaterThanOrEqual(
      visibleMean('mid') * 0.9,
    );
    expect(
      aggregate.early.multiRowJumpGates +
        aggregate.mid.multiRowJumpGates +
        aggregate.late.multiRowJumpGates,
    ).toBeGreaterThanOrEqual(8);
  }, 30_000);

  it('makes both jumping and lane changes necessary in mixed challenges', () => {
    const runSabotage = (mode: 'no-jump' | 'fixed-lane') => {
      const simulation = new AutorooSimulation(0xa770_2026);
      let foundMixedChallenge = false;
      simulation.start();

      for (
        let step = 0;
        step < 30_000 && simulation.renderPlayer.absoluteZM < 10_000;
        step += 1
      ) {
        const snapshot = simulation.snapshot();
        const certificate = snapshot.activeCertificate;
        foundMixedChallenge ||=
          certificate !== null && isMixedChallenge(certificate);
        let input = certificateBotInput(simulation, snapshot);
        if (foundMixedChallenge && certificate) {
          input =
            mode === 'no-jump'
              ? { ...input, jumpPressed: false }
              : {
                  laneDelta: 0,
                  jumpPressed:
                    snapshot.tick >=
                    Math.floor(
                      (certificate.safeTakeoffTickMin +
                        certificate.safeTakeoffTickMax) /
                        2,
                    ),
                };
        }
        simulation.tick(input);
        simulation.drainEvents();
        if (simulation.phaseName === 'game-over') break;
      }
      return { foundMixedChallenge, phase: simulation.phaseName };
    };

    expect(runSabotage('no-jump')).toEqual({
      foundMixedChallenge: true,
      phase: 'game-over',
    });
    expect(runSabotage('fixed-lane')).toEqual({
      foundMixedChallenge: true,
      phase: 'game-over',
    });
  }, 20_000);
});
