import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  TRAFFIC_PREGEN_AHEAD_M,
  TRAFFIC_RENDER_AHEAD_M,
} from '../app/game/constants';
import type { ChallengeCertificate } from '../app/game/contracts';
import { laneMaskAt } from '../app/game/generator';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((first, second) => first - second);
  return ordered[Math.floor((ordered.length - 1) * fraction)] ?? 0;
}

function rowStarts(certificate: ChallengeCertificate): number[] {
  return [
    ...new Set(
      certificate.blockerTrajectories.map(
        (trajectory) => Math.round(trajectory.startZM * 1000) / 1000,
      ),
    ),
  ].sort((first, second) => first - second);
}

function assertDemandingChallenge(
  seed: number,
  certificate: ChallengeCertificate,
): void {
  const plan = certificate.maneuverPlan;
  const jumpRows = plan.filter((row) => row.action === 'jump');
  const dodgeRows = plan.filter((row) => row.action === 'dodge');
  const firstStartM = rowStarts(certificate)[0];
  expect([5, 7], certificate.id).toContain(plan.length);
  expect(certificate.selectedVehicle, certificate.id).toBe('bus');
  expect(jumpRows.length, certificate.id).toBeGreaterThanOrEqual(3);
  expect(dodgeRows.length, certificate.id).toBeGreaterThanOrEqual(2);
  expect(plan.at(-1)!.offsetM, certificate.id).toBeGreaterThanOrEqual(67.5);
  expect(plan.at(-1)!.offsetM, certificate.id).toBeLessThanOrEqual(135);
  expect(certificate.inputWindowS, certificate.id).toBeGreaterThanOrEqual(0.1);
  expect(certificate.inputWindowS, certificate.id).toBeLessThanOrEqual(0.2);
  for (const [index, row] of plan.entries()) {
    const startM = firstStartM + row.offsetM;
    const activeMask = laneMaskAt(seed, startM);
    const actualMask = certificate.blockerTrajectories
      .filter((trajectory) => Math.abs(trajectory.startZM - startM) < 0.001)
      .reduce((mask, trajectory) => mask | (1 << trajectory.lane), 0);
    expect(row.blockedLaneMask, certificate.id).toBe(actualMask);
    expect(row.blockedLaneMask & ~activeMask, certificate.id).toBe(0);
    expect(activeMask & (1 << row.targetLane), certificate.id).not.toBe(0);
    if (index > 0) {
      const gapM = row.offsetM - plan[index - 1].offsetM;
      expect(gapM, certificate.id).toBeGreaterThanOrEqual(16);
      expect(gapM, certificate.id).toBeLessThanOrEqual(26);
    }
    if (row.action === 'jump') {
      expect(row.blockedLaneMask, certificate.id).toBe(activeMask);
    } else {
      // A dodge must require this exact escape lane, rather than leaving
      // multiple lanes that let a player coast through the sequence.
      expect(activeMask & ~row.blockedLaneMask, certificate.id).toBe(
        1 << row.targetLane,
      );
      expect(
        Math.abs(row.targetLane - plan[index - 1].targetLane),
        certificate.id,
      ).toBe(1);
    }
  }
  expect(
    certificate.witness.filter((point) => point.input.jumpPressed).length,
    `${certificate.id} must prove separately timed jumps`,
  ).toBeGreaterThanOrEqual(jumpRows.length);
  expect(
    certificate.witness.some((point) => point.input.laneDelta !== 0),
    certificate.id,
  ).toBe(true);
}

type Band = 'early' | 'mid' | 'late';
interface BandStats {
  visible: number;
  near: number;
  samples: number;
  steering: number;
  jumps: number;
}
function makeStats(): Record<Band, BandStats> {
  const empty = (): BandStats => ({
    visible: 0,
    near: 0,
    samples: 0,
    steering: 0,
    jumps: 0,
  });
  return { early: empty(), mid: empty(), late: empty() };
}
function bandAt(distanceM: number): Band | null {
  if (distanceM < 1000) return 'early';
  if (distanceM >= 2000 && distanceM < 4000) return 'mid';
  if (distanceM >= 8000 && distanceM < 10_000) return 'late';
  return null;
}

describe('progressive production traffic density', () => {
  it('keeps the traffic generation frontier behind the render boundary', () => {
    expect(TRAFFIC_PREGEN_AHEAD_M).toBeGreaterThan(TRAFFIC_RENDER_AHEAD_M);
  });

  it('requires frequent actions in dense traffic and tightly spaced mixed challenges', () => {
    const seeds = [
      0xa770_2026, 7, 19, 41, 71, 131, 211, 307, 401, 503, 601, 809,
    ];
    const aggregate = makeStats();
    for (const seed of seeds) {
      const simulation = new AutorooSimulation(seed);
      const stats = makeStats();
      const seenTraffic = new Set(
        simulation.snapshot().traffic.map((vehicle) => vehicle.id),
      );
      const seenGround = new Set<string>();
      const seenGates = new Set<string>();
      const gateStartsM: number[] = [];
      const lateRowGapsM: number[] = [];
      const lateActionIntervalsS: number[] = [];
      let previousGroundLane = simulation.snapshot().player.lane;
      let previousGroundZM = Number.NEGATIVE_INFINITY;
      let activeGateId: string | null = null;
      let clearedGates = 0;
      let emptyTicks = 0;
      let maxEmptyTicks = 0;
      let lateTicks = 0;
      let lateVisibleTicks = 0;
      let actionLullTicks = 0;
      let maxActionLullTicks = 0;
      let lastActionTick: number | null = null;
      simulation.start();
      for (
        let step = 0;
        step < 25_000 && simulation.renderPlayer.absoluteZM < 10_000;
        step += 1
      ) {
        const snapshot = simulation.snapshot();
        for (const vehicle of snapshot.traffic) {
          if (seenTraffic.has(vehicle.id)) continue;
          seenTraffic.add(vehicle.id);
          expect(
            vehicle.absoluteZM - snapshot.player.absoluteZM,
            `${vehicle.id} was born inside the visible scene for seed ${seed}`,
          ).toBeGreaterThan(TRAFFIC_RENDER_AHEAD_M);
        }
        for (const certificate of simulation.getGroundCertificates()) {
          if (seenGround.has(certificate.id)) continue;
          if (
            !snapshot.traffic.some(
              (vehicle) =>
                vehicle.certificateId === certificate.id &&
                vehicle.absoluteZM - snapshot.player.absoluteZM <=
                  TRAFFIC_RENDER_AHEAD_M,
            )
          )
            continue;
          seenGround.add(certificate.id);
          const startM = rowStarts(certificate)[0];
          if (startM - previousGroundZM < 150) {
            expect(
              Math.abs(certificate.targetLane - previousGroundLane),
              `${seed}:${certificate.id}: ${previousGroundLane} to ${certificate.targetLane}`,
            ).toBeLessThanOrEqual(1);
          }
          previousGroundLane = certificate.targetLane;
          previousGroundZM = startM;
        }
        const gate = snapshot.activeCertificate;
        if (gate && !seenGates.has(gate.id)) {
          seenGates.add(gate.id);
          assertDemandingChallenge(seed, gate);
          const startM = rowStarts(gate)[0];
          if (startM < 10_000) gateStartsM.push(startM);
          for (const route of gate.approachRoutes) {
            const ground = simulation
              .getGroundCertificates()
              .find((candidate) =>
                candidate.blockerTrajectories.some(
                  (trajectory) => trajectory.encounterId === route.encounterId,
                ),
              );
            expect(ground, route.encounterId).toBeDefined();
            expect(ground!.revealTick, route.encounterId).toBeLessThan(
              gate.revealTick,
            );
          }
        }
        if (gate) {
          activeGateId = gate.id;
        } else if (activeGateId !== null) {
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
            `${activeGateId} continuation`,
          ).toBeLessThanOrEqual(75);
          expect(
            continuationRowsM.filter((leadM) => leadM <= 200).length,
            `${activeGateId} continuation`,
          ).toBeGreaterThanOrEqual(4);
          expect(
            Math.max(
              ...continuationRowsM
                .slice(1, 4)
                .map((leadM, index) => leadM - continuationRowsM[index]),
            ),
            `${activeGateId} continuation spacing`,
          ).toBeLessThanOrEqual(48);
          clearedGates += 1;
          activeGateId = null;
        }

        const visible = snapshot.traffic.filter(
          (vehicle) =>
            vehicle.absoluteZM > snapshot.player.absoluteZM &&
            vehicle.absoluteZM <= snapshot.player.absoluteZM + 260,
        );
        if (snapshot.player.absoluteZM >= 500) {
          emptyTicks = visible.length > 0 ? 0 : emptyTicks + 1;
          maxEmptyTicks = Math.max(maxEmptyTicks, emptyTicks);
        }
        if (snapshot.player.absoluteZM >= 2000) {
          lateTicks += 1;
          if (visible.length > 0) lateVisibleTicks += 1;
          if (step % 30 === 0) {
            // Compare simultaneous physical coordinates: initial certificate
            // coordinates from different reveal ticks cannot measure a live gap.
            const rowsM = [
              ...new Set(
                visible.map(
                  (vehicle) => Math.round(vehicle.absoluteZM * 1000) / 1000,
                ),
              ),
            ].sort((first, second) => first - second);
            lateRowGapsM.push(
              ...rowsM.slice(1).map((rowM, index) => rowM - rowsM[index]),
            );
          }
        }
        const band = bandAt(snapshot.player.absoluteZM);
        if (band && step % 30 === 0) {
          stats[band].visible += visible.length;
          stats[band].near += visible.filter(
            (vehicle) => vehicle.absoluteZM <= snapshot.player.absoluteZM + 80,
          ).length;
          stats[band].samples += 1;
        }
        const input = certificateBotInput(simulation, snapshot);
        simulation.tick(input);
        const committedSteer =
          simulation.renderPlayer.lane !== snapshot.player.lane;
        const jumpStarted =
          !snapshot.player.airborne && simulation.renderPlayer.airborne;
        if (band) {
          stats[band].steering += Number(committedSteer);
          stats[band].jumps += Number(jumpStarted);
        }
        if (snapshot.player.absoluteZM >= 2000) {
          // Visible obstacles, an active certificate, and rejected button
          // presses do not count as actions. Count the committed state changes.
          if (committedSteer || jumpStarted) {
            if (lastActionTick !== null)
              lateActionIntervalsS.push(
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
            step,
            zM: snapshot.player.absoluteZM,
            lane: snapshot.player.lane,
            input,
            gate: gate?.id ?? null,
          }),
        ).toBe('running');
        simulation.drainEvents();
      }
      expect(
        simulation.renderPlayer.absoluteZM,
        `seed ${seed}`,
      ).toBeGreaterThanOrEqual(10_000);
      expect(clearedGates, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      gateStartsM.sort((first, second) => first - second);
      expect(
        gateStartsM[0],
        `seed ${seed} first mandatory jump`,
      ).toBeLessThanOrEqual(600);
      expect(gateStartsM.length, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      const coverageGapsM = [
        gateStartsM[0],
        ...gateStartsM
          .slice(1)
          .map((startM, index) => startM - gateStartsM[index]),
        10_000 - gateStartsM.at(-1)!,
      ];
      expect(
        Math.max(...coverageGapsM),
        `seed ${seed} challenge coverage`,
      ).toBeLessThanOrEqual(1100);
      expect(maxEmptyTicks * FIXED_DT, `seed ${seed}`).toBeLessThanOrEqual(1.5);
      expect(
        lateVisibleTicks / lateTicks,
        `seed ${seed}`,
      ).toBeGreaterThanOrEqual(0.98);
      expect(
        maxActionLullTicks * FIXED_DT,
        `seed ${seed} actual action lull`,
      ).toBeLessThanOrEqual(3.5);
      expect(
        percentile(lateActionIntervalsS, 0.9),
        `seed ${seed} actual action intervals`,
      ).toBeLessThanOrEqual(0.8);
      expect(
        percentile(lateRowGapsM, 0.9),
        `seed ${seed} physical row gaps`,
      ).toBeLessThanOrEqual(22.3);
      expect(
        stats.late.visible / stats.late.samples,
        `seed ${seed} visible traffic`,
      ).toBeGreaterThanOrEqual(24);
      expect(
        stats.late.near / stats.late.samples,
        `seed ${seed} close traffic`,
      ).toBeGreaterThanOrEqual(7);
      expect(
        stats.late.steering / 2,
        `seed ${seed} steering per km`,
      ).toBeGreaterThanOrEqual(35);
      expect(
        (stats.late.steering + stats.late.jumps) / 2,
        `seed ${seed} actions per km`,
      ).toBeGreaterThanOrEqual(45);
      for (const bandName of ['early', 'mid', 'late'] as const) {
        for (const key of [
          'visible',
          'near',
          'samples',
          'steering',
          'jumps',
        ] as const)
          aggregate[bandName][key] += stats[bandName][key];
      }
    }
    const visibleMean = (band: Band) =>
      aggregate[band].visible / aggregate[band].samples;
    const actionRate = (band: Band, lengthKm: number) =>
      (aggregate[band].steering + aggregate[band].jumps) /
      seeds.length /
      lengthKm;
    expect(visibleMean('mid')).toBeGreaterThan(visibleMean('early') * 1.2);
    expect(visibleMean('late')).toBeGreaterThanOrEqual(
      visibleMean('mid') * 0.95,
    );
    expect(actionRate('late', 2)).toBeGreaterThan(actionRate('early', 1) * 1.2);
    expect(actionRate('late', 2)).toBeGreaterThanOrEqual(
      actionRate('mid', 2) * 0.95,
    );
  }, 60_000);

  it('requires steering and separately timed jumps rather than continuous auto-hopping', () => {
    const runSabotage = (mode: 'no-jump' | 'fixed-lane' | 'hold-jump') => {
      const simulation = new AutorooSimulation(0xa770_2026);
      let foundChallenge = false;
      simulation.start();
      for (
        let step = 0;
        step < 4000 && simulation.phaseName === 'running';
        step += 1
      ) {
        const snapshot = simulation.snapshot();
        const gate = snapshot.activeCertificate;
        let input = certificateBotInput(simulation, snapshot);
        if (gate) {
          foundChallenge = true;
          if (mode === 'no-jump') input = { ...input, jumpPressed: false };
          if (mode === 'fixed-lane') input = { ...input, laneDelta: 0 };
          if (mode === 'hold-jump')
            input = {
              ...input,
              jumpPressed:
                snapshot.tick >=
                Math.floor(
                  (gate.safeTakeoffTickMin + gate.safeTakeoffTickMax) / 2,
                ),
            };
        }
        simulation.tick(input);
        simulation.drainEvents();
      }
      return { foundChallenge, phase: simulation.phaseName };
    };
    for (const mode of ['no-jump', 'fixed-lane', 'hold-jump'] as const) {
      expect(runSabotage(mode), mode).toEqual({
        foundChallenge: true,
        phase: 'game-over',
      });
    }
  }, 20_000);
});
