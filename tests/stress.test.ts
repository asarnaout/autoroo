import { describe, expect, it } from 'vitest';
import { FIXED_DT, TRAFFIC_RENDER_AHEAD_M } from '../app/game/constants';
import type { ChallengeCertificate, LaneIndex } from '../app/game/contracts';
import { roadModuleAt } from '../app/game/generator';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

const stress = process.env.AUTOROO_STRESS === '1';

interface ManeuverPlanRow {
  readonly offsetM: number;
  readonly blockedLaneMask: number;
  readonly action: 'jump' | 'dodge';
  readonly targetLane: LaneIndex;
}

function maneuverPlan(
  certificate: ChallengeCertificate,
): readonly ManeuverPlanRow[] {
  return (
    (
      certificate as ChallengeCertificate & {
        readonly maneuverPlan?: readonly ManeuverPlanRow[];
      }
    ).maneuverPlan ?? []
  );
}

function isLongMixedChallenge(certificate: ChallengeCertificate): boolean {
  const plan = [...maneuverPlan(certificate)].sort(
    (first, second) => first.offsetM - second.offsetM,
  );
  if (plan.length < 2) return false;
  const jumps = plan.filter((row) => row.action === 'jump').length;
  const dodges = plan.filter((row) => row.action === 'dodge');
  const targets = dodges.map((row) => row.targetLane);
  const gaps = plan
    .slice(1)
    .map((row, index) => row.offsetM - plan[index].offsetM);
  const actionChanges = plan
    .slice(1)
    .filter((row, index) => row.action !== plan[index].action).length;
  const targetChanges = targets
    .slice(1)
    .filter((lane, index) => lane !== targets[index]).length;
  return (
    plan.length >= 20 &&
    jumps >= 3 &&
    dodges.length >= 17 &&
    plan.at(-1)!.offsetM - plan[0].offsetM >= 285 &&
    Math.max(...gaps) <= 18 &&
    actionChanges >= 3 &&
    new Set(targets).size >= 2 &&
    targetChanges >= 2 &&
    certificate.witness.some((point) => point.input.jumpPressed) &&
    certificate.witness.some((point) => point.input.laneDelta !== 0)
  );
}

function isMixedChallenge(certificate: ChallengeCertificate): boolean {
  const actions = new Set(maneuverPlan(certificate).map((row) => row.action));
  return actions.has('jump') && actions.has('dodge');
}

describe.runIf(stress)('long-run procedural stress', () => {
  it('generates one million absolute modules without retaining generated content', () => {
    let checksum = 0;
    for (let index = 0; index < 1_000_000; index += 1) {
      const roadModule = roadModuleAt(0x51eed, index);
      checksum =
        (checksum +
          roadModule.fromLaneMask * 17 +
          roadModule.toLaneMask * 31) >>>
        0;
    }
    expect(checksum).not.toBe(0);
  }, 60_000);

  it('drives the production simulation for 100 km per seed with bounded retained state', () => {
    for (const seed of [7, 71, 701]) {
      const simulation = new AutorooSimulation(seed);
      simulation.start();
      const laneCounts = new Set<number>();
      const ordinaryEncounters = new Set<string>();
      const clearedGates = new Set<string>();
      const seenCertificates = new Set<string>();
      const lateRowKeys = new Set<string>();
      const mixedChallengeStartsM: number[] = [];
      const seenTrafficIds = new Set(
        simulation.snapshot().traffic.map((vehicle) => vehicle.id),
      );
      let activeGateId: string | null = null;
      let maxFrontCars = 0;
      let maxBuses = 0;
      let maxGroundCertificates = 0;
      let emptyViewStartedM: number | null = null;
      let maxEmptyViewM = 0;
      let emptyViewTicks = 0;
      let maxEmptyViewTicks = 0;
      let lateEmptyViewTicks = 0;
      let lateTicks = 0;
      let maneuverLullTicks = 0;
      let maxManeuverLullTicks = 0;
      let steps = 0;

      while (simulation.renderPlayer.absoluteZM < 100_000 && steps < 260_000) {
        const snapshot = simulation.snapshot();
        laneCounts.add(snapshot.laneCount);
        for (const vehicle of snapshot.traffic) {
          if (!seenTrafficIds.has(vehicle.id)) {
            seenTrafficIds.add(vehicle.id);
            expect(
              vehicle.absoluteZM - snapshot.player.absoluteZM,
              `${vehicle.id} was born inside the visible scene for seed ${seed}`,
            ).toBeGreaterThan(TRAFFIC_RENDER_AHEAD_M);
          }
          if (vehicle.role === 'ordinary')
            ordinaryEncounters.add(vehicle.encounterId);
        }
        const certificates = [
          ...simulation.getGroundCertificates(),
          ...(snapshot.activeCertificate ? [snapshot.activeCertificate] : []),
        ];
        for (const certificate of certificates) {
          if (seenCertificates.has(certificate.id)) continue;
          seenCertificates.add(certificate.id);
          for (const startM of new Set(
            certificate.blockerTrajectories.map(
              (trajectory) => Math.round(trajectory.startZM * 1000) / 1000,
            ),
          )) {
            if (startM >= 2000) lateRowKeys.add(`${certificate.id}:${startM}`);
          }
          if (isLongMixedChallenge(certificate)) {
            const startM = Math.min(
              ...certificate.blockerTrajectories.map(
                (trajectory) => trajectory.startZM,
              ),
            );
            if (startM >= 2000) mixedChallengeStartsM.push(startM);
          }
        }
        if (snapshot.activeCertificate)
          activeGateId = snapshot.activeCertificate.id;
        else if (activeGateId) {
          clearedGates.add(activeGateId);
          activeGateId = null;
        }

        const hasVisibleObstacle = snapshot.traffic.some(
          (vehicle) =>
            vehicle.absoluteZM > snapshot.player.absoluteZM &&
            vehicle.absoluteZM <= snapshot.player.absoluteZM + 260,
        );
        if (!hasVisibleObstacle) {
          emptyViewStartedM ??= snapshot.player.absoluteZM;
          if (snapshot.player.absoluteZM >= 500) emptyViewTicks += 1;
        } else if (emptyViewStartedM !== null) {
          maxEmptyViewM = Math.max(
            maxEmptyViewM,
            snapshot.player.absoluteZM - emptyViewStartedM,
          );
          emptyViewStartedM = null;
          maxEmptyViewTicks = Math.max(maxEmptyViewTicks, emptyViewTicks);
          emptyViewTicks = 0;
        } else {
          maxEmptyViewTicks = Math.max(maxEmptyViewTicks, emptyViewTicks);
          emptyViewTicks = 0;
        }
        if (snapshot.player.absoluteZM >= 2000) {
          lateTicks += 1;
          if (!hasVisibleObstacle) lateEmptyViewTicks += 1;
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
            steps,
            zM: snapshot.player.absoluteZM,
            lane: snapshot.player.lane,
            input,
            certificate: snapshot.activeCertificate?.id ?? null,
            nearby: snapshot.traffic
              .filter(
                (vehicle) =>
                  Math.abs(vehicle.absoluteZM - snapshot.player.absoluteZM) <
                  20,
              )
              .map((vehicle) => ({
                id: vehicle.id,
                role: vehicle.role,
                lane: vehicle.lane,
                zM: vehicle.absoluteZM,
              })),
          }),
        ).toBe('running');

        const counts = simulation.debugRetainedCounts();
        maxFrontCars = Math.max(maxFrontCars, counts.frontCars);
        maxBuses = Math.max(maxBuses, counts.buses);
        maxGroundCertificates = Math.max(
          maxGroundCertificates,
          counts.groundCertificates,
        );
        expect(counts.frontCars).toBeLessThanOrEqual(40);
        expect(counts.buses).toBeLessThanOrEqual(16);
        expect(counts.totalTraffic).toBeLessThanOrEqual(56);
        expect(counts.activeCertificates).toBeLessThanOrEqual(1);
        expect(counts.groundCertificates).toBeLessThanOrEqual(18);
        expect(counts.witnessPoints).toBeLessThanOrEqual(2000);
        expect(
          new Set(simulation.renderTraffic.map((vehicle) => vehicle.id)).size,
        ).toBe(simulation.renderTraffic.length);
        expect(simulation.drainEvents().length).toBeLessThanOrEqual(5);
        steps += 1;
      }

      const final = simulation.snapshot();
      if (emptyViewStartedM !== null) {
        maxEmptyViewM = Math.max(
          maxEmptyViewM,
          final.player.absoluteZM - emptyViewStartedM,
        );
      }
      maxEmptyViewTicks = Math.max(maxEmptyViewTicks, emptyViewTicks);
      maxManeuverLullTicks = Math.max(maxManeuverLullTicks, maneuverLullTicks);
      expect(final.player.absoluteZM).toBeGreaterThanOrEqual(100_000);
      expect(final.difficulty).toBeGreaterThan(0.999);
      expect(laneCounts).toEqual(new Set([2, 3, 4]));
      // Exact moving-trajectory reservations and obstacle-free tapers still
      // reject some candidates from the bounded 30–34 m late-game cadence.
      // Both challenge kinds must nevertheless recur throughout the run.
      expect(clearedGates.size).toBeGreaterThan(40);
      expect(ordinaryEncounters.size).toBeGreaterThan(500);
      expect(steps).toBeLessThan(260_000);
      expect(maxFrontCars).toBeGreaterThan(0);
      expect(maxBuses).toBeGreaterThan(0);
      expect(maxGroundCertificates).toBeGreaterThan(0);
      expect(maxEmptyViewTicks * FIXED_DT).toBeLessThanOrEqual(1.5);
      expect(maxEmptyViewM).toBeLessThanOrEqual(55);
      expect(lateEmptyViewTicks / lateTicks).toBeLessThanOrEqual(0.02);
      expect(maxManeuverLullTicks * FIXED_DT).toBeLessThanOrEqual(3);
      expect(lateRowKeys.size).toBeGreaterThanOrEqual(1600);
      mixedChallengeStartsM.sort((first, second) => first - second);
      expect(mixedChallengeStartsM.length).toBeGreaterThanOrEqual(60);
      if (mixedChallengeStartsM.length > 0) {
        const coverageGapsM = [
          mixedChallengeStartsM[0] - 2000,
          ...mixedChallengeStartsM
            .slice(1)
            .map((startM, index) => startM - mixedChallengeStartsM[index]),
          100_000 - mixedChallengeStartsM.at(-1)!,
        ];
        expect(Math.max(...coverageGapsM)).toBeLessThanOrEqual(3500);
      }
    }
  }, 120_000);
});
