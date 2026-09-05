import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  RENDER_POOL_LIMITS,
  TRAFFIC_RENDER_AHEAD_M,
} from '../app/game/constants';
import type { ChallengeCertificate } from '../app/game/contracts';
import { laneMaskAt, roadModuleAt } from '../app/game/generator';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

const stress = process.env.AUTOROO_STRESS === '1';

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((first, second) => first - second);
  return ordered[Math.floor((ordered.length - 1) * fraction)] ?? 0;
}

function assertDemandingChallenge(
  seed: number,
  certificate: ChallengeCertificate,
): void {
  const plan = certificate.maneuverPlan;
  const firstStartM = Math.min(
    ...certificate.blockerTrajectories.map((trajectory) => trajectory.startZM),
  );
  expect([5, 7], certificate.id).toContain(plan.length);
  expect(certificate.selectedVehicle, certificate.id).toBe('bus');
  expect(
    plan.filter((row) => row.action === 'jump').length,
    certificate.id,
  ).toBeGreaterThanOrEqual(3);
  expect(
    plan.filter((row) => row.action === 'dodge').length,
    certificate.id,
  ).toBeGreaterThanOrEqual(2);
  for (const [index, row] of plan.entries()) {
    const activeMask = laneMaskAt(seed, firstStartM + row.offsetM);
    if (row.action === 'jump') {
      expect(row.blockedLaneMask, certificate.id).toBe(activeMask);
    } else {
      expect(activeMask & ~row.blockedLaneMask, certificate.id).toBe(
        1 << row.targetLane,
      );
      expect(
        Math.abs(row.targetLane - plan[index - 1].targetLane),
        certificate.id,
      ).toBe(1);
    }
  }
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

  it('maintains dense, demanding, solvable traffic for 100 km per seed with bounded retained state', () => {
    for (const seed of [7, 71, 701]) {
      const simulation = new AutorooSimulation(seed);
      simulation.start();
      const laneCounts = new Set<number>();
      const ordinaryEncounters = new Set<string>();
      const clearedGates = new Set<string>();
      const seenCertificates = new Set<string>();
      const lateRowKeys = new Set<string>();
      const gateStartsM: number[] = [];
      const liveRowGapsM: number[] = [];
      const actionIntervalsS: number[] = [];
      const seenTrafficIds = new Set(
        simulation.snapshot().traffic.map((vehicle) => vehicle.id),
      );
      let activeGateId: string | null = null;
      let previousGroundLane = simulation.snapshot().player.lane;
      let previousGroundZM = Number.NEGATIVE_INFINITY;
      let maxFrontCars = 0;
      let maxBuses = 0;
      let maxGroundCertificates = 0;
      let emptyViewStartedM: number | null = null;
      let maxEmptyViewM = 0;
      let emptyViewTicks = 0;
      let maxEmptyViewTicks = 0;
      let lateEmptyViewTicks = 0;
      let lateTicks = 0;
      let actionLullTicks = 0;
      let maxActionLullTicks = 0;
      let lastActionTick: number | null = null;
      let committedSteers = 0;
      let jumpStarts = 0;
      let visibleSum = 0;
      let nearSum = 0;
      let visibilitySamples = 0;
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
        for (const certificate of simulation.getGroundCertificates()) {
          if (seenCertificates.has(certificate.id)) continue;
          seenCertificates.add(certificate.id);
          const startM = certificate.blockerTrajectories[0].startZM;
          if (startM - previousGroundZM < 150) {
            expect(
              Math.abs(certificate.targetLane - previousGroundLane),
              `${seed}:${certificate.id}: ${previousGroundLane} to ${certificate.targetLane}`,
            ).toBeLessThanOrEqual(1);
          }
          previousGroundLane = certificate.targetLane;
          previousGroundZM = startM;
          if (startM >= 2000 && startM < 100_000)
            lateRowKeys.add(certificate.id);
        }
        const gate = snapshot.activeCertificate;
        if (gate) {
          activeGateId = gate.id;
          if (!seenCertificates.has(gate.id)) {
            seenCertificates.add(gate.id);
            assertDemandingChallenge(seed, gate);
            const firstStartM = Math.min(
              ...gate.blockerTrajectories.map(
                (trajectory) => trajectory.startZM,
              ),
            );
            if (firstStartM < 100_000) gateStartsM.push(firstStartM);
            for (const row of gate.maneuverPlan) {
              const startM = firstStartM + row.offsetM;
              if (startM >= 2000 && startM < 100_000)
                lateRowKeys.add(`${gate.id}:${row.offsetM}`);
            }
          }
        } else if (activeGateId) {
          clearedGates.add(activeGateId);
          activeGateId = null;
        }

        const visible = snapshot.traffic.filter(
          (vehicle) =>
            vehicle.absoluteZM > snapshot.player.absoluteZM &&
            vehicle.absoluteZM <= snapshot.player.absoluteZM + 260,
        );
        if (visible.length === 0) {
          emptyViewStartedM ??= snapshot.player.absoluteZM;
          if (snapshot.player.absoluteZM >= 500) emptyViewTicks += 1;
        } else {
          if (emptyViewStartedM !== null)
            maxEmptyViewM = Math.max(
              maxEmptyViewM,
              snapshot.player.absoluteZM - emptyViewStartedM,
            );
          emptyViewStartedM = null;
          emptyViewTicks = 0;
        }
        maxEmptyViewTicks = Math.max(maxEmptyViewTicks, emptyViewTicks);
        if (snapshot.player.absoluteZM >= 2000) {
          lateTicks += 1;
          if (visible.length === 0) lateEmptyViewTicks += 1;
          if (steps % 120 === 0) {
            visibleSum += visible.length;
            nearSum += visible.filter(
              (vehicle) =>
                vehicle.absoluteZM <= snapshot.player.absoluteZM + 80,
            ).length;
            visibilitySamples += 1;
            const rowsM = [
              ...new Set(
                visible.map(
                  (vehicle) => Math.round(vehicle.absoluteZM * 1000) / 1000,
                ),
              ),
            ].sort((first, second) => first - second);
            liveRowGapsM.push(
              ...rowsM.slice(1).map((rowM, index) => rowM - rowsM[index]),
            );
          }
        }
        const input = certificateBotInput(simulation, snapshot);
        simulation.tick(input);
        if (snapshot.player.absoluteZM >= 2000) {
          const committedSteer =
            simulation.renderPlayer.lane !== snapshot.player.lane;
          const jumpStarted =
            !snapshot.player.airborne && simulation.renderPlayer.airborne;
          committedSteers += Number(committedSteer);
          jumpStarts += Number(jumpStarted);
          // Count actual changes to the player, not traffic visibility, active
          // certificates, or rejected input. Otherwise long coasts pass as busy.
          if (committedSteer || jumpStarted) {
            if (lastActionTick !== null)
              actionIntervalsS.push(
                (snapshot.tick - lastActionTick) * FIXED_DT,
              );
            lastActionTick = snapshot.tick;
            actionLullTicks = 0;
          } else {
            actionLullTicks += 1;
            maxActionLullTicks = Math.max(maxActionLullTicks, actionLullTicks);
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
            gate: gate?.id ?? null,
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
        expect(counts.frontCars).toBeLessThanOrEqual(
          RENDER_POOL_LIMITS.frontCars,
        );
        expect(counts.buses).toBeLessThanOrEqual(RENDER_POOL_LIMITS.buses);
        expect(counts.totalTraffic).toBeLessThanOrEqual(
          RENDER_POOL_LIMITS.frontCars + RENDER_POOL_LIMITS.buses,
        );
        expect(counts.activeCertificates).toBeLessThanOrEqual(1);
        expect(counts.groundCertificates).toBeLessThanOrEqual(26);
        expect(counts.witnessPoints).toBeLessThanOrEqual(3000);
        expect(
          new Set(simulation.renderTraffic.map((vehicle) => vehicle.id)).size,
        ).toBe(simulation.renderTraffic.length);
        expect(simulation.drainEvents().length).toBeLessThanOrEqual(5);
        steps += 1;
      }
      const final = simulation.snapshot();
      if (emptyViewStartedM !== null)
        maxEmptyViewM = Math.max(
          maxEmptyViewM,
          final.player.absoluteZM - emptyViewStartedM,
        );
      expect(final.player.absoluteZM).toBeGreaterThanOrEqual(100_000);
      expect(final.difficulty).toBeGreaterThan(0.999);
      expect(laneCounts).toEqual(new Set([2, 3, 4]));
      expect(clearedGates.size, `seed ${seed}`).toBeGreaterThanOrEqual(100);
      expect(ordinaryEncounters.size, `seed ${seed}`).toBeGreaterThanOrEqual(
        2000,
      );
      expect(steps).toBeLessThan(260_000);
      expect(maxFrontCars).toBeGreaterThan(0);
      expect(maxBuses).toBeGreaterThan(0);
      expect(maxGroundCertificates).toBeGreaterThan(0);
      expect(maxEmptyViewTicks * FIXED_DT, `seed ${seed}`).toBeLessThanOrEqual(
        1.5,
      );
      expect(maxEmptyViewM, `seed ${seed}`).toBeLessThanOrEqual(55);
      expect(
        lateEmptyViewTicks / lateTicks,
        `seed ${seed}`,
      ).toBeLessThanOrEqual(0.02);
      expect(
        maxActionLullTicks * FIXED_DT,
        `seed ${seed} actual action lull`,
      ).toBeLessThanOrEqual(3.5);
      expect(
        percentile(actionIntervalsS, 0.9),
        `seed ${seed} actual action intervals`,
      ).toBeLessThanOrEqual(0.8);
      expect(
        committedSteers / 98,
        `seed ${seed} steering per km`,
      ).toBeGreaterThanOrEqual(35);
      expect(
        (committedSteers + jumpStarts) / 98,
        `seed ${seed} actions per km`,
      ).toBeGreaterThanOrEqual(45);
      expect(
        visibleSum / visibilitySamples,
        `seed ${seed} visible traffic`,
      ).toBeGreaterThanOrEqual(24);
      expect(
        nearSum / visibilitySamples,
        `seed ${seed} close traffic`,
      ).toBeGreaterThanOrEqual(7);
      expect(
        percentile(liveRowGapsM, 0.9),
        `seed ${seed} physical row gaps`,
      ).toBeLessThanOrEqual(22.3);
      expect(lateRowKeys.size, `seed ${seed}`).toBeGreaterThanOrEqual(3200);
      gateStartsM.sort((first, second) => first - second);
      expect(
        gateStartsM[0],
        `seed ${seed} first mandatory jump`,
      ).toBeLessThanOrEqual(600);
      expect(gateStartsM.length, `seed ${seed}`).toBeGreaterThanOrEqual(100);
      const coverageGapsM = [
        gateStartsM[0],
        ...gateStartsM
          .slice(1)
          .map((startM, index) => startM - gateStartsM[index]),
        100_000 - gateStartsM.at(-1)!,
      ];
      expect(
        Math.max(...coverageGapsM),
        `seed ${seed} challenge coverage`,
      ).toBeLessThanOrEqual(1100);
    }
  }, 120_000);
});
