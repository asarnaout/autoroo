import { describe, expect, it } from 'vitest';
import { roadModuleAt } from '../app/game/generator';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

const stress = process.env.AUTOROO_STRESS === '1';

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
      let activeGateId: string | null = null;
      let maxFrontCars = 0;
      let maxBuses = 0;
      let maxRearCars = 0;
      let maxGroundCertificates = 0;
      let steps = 0;

      while (simulation.renderPlayer.absoluteZM < 100_000 && steps < 260_000) {
        const snapshot = simulation.snapshot();
        laneCounts.add(snapshot.laneCount);
        for (const vehicle of snapshot.traffic) {
          if (vehicle.role === 'ordinary')
            ordinaryEncounters.add(vehicle.encounterId);
        }
        if (snapshot.activeCertificate)
          activeGateId = snapshot.activeCertificate.id;
        else if (activeGateId) {
          clearedGates.add(activeGateId);
          activeGateId = null;
        }

        const input = certificateBotInput(simulation, snapshot);
        simulation.tick(input);
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
        maxRearCars = Math.max(maxRearCars, counts.rearCars);
        maxGroundCertificates = Math.max(
          maxGroundCertificates,
          counts.groundCertificates,
        );
        expect(counts.frontCars).toBeLessThanOrEqual(40);
        expect(counts.buses).toBeLessThanOrEqual(16);
        expect(counts.rearCars).toBeLessThanOrEqual(4);
        expect(counts.totalTraffic).toBeLessThanOrEqual(60);
        expect(counts.activeCertificates).toBeLessThanOrEqual(1);
        expect(counts.groundCertificates).toBeLessThanOrEqual(12);
        expect(counts.witnessPoints).toBeLessThanOrEqual(1200);
        expect(
          new Set(simulation.renderTraffic.map((vehicle) => vehicle.id)).size,
        ).toBe(simulation.renderTraffic.length);
        expect(simulation.drainEvents().length).toBeLessThanOrEqual(5);
        steps += 1;
      }

      const final = simulation.snapshot();
      expect(final.player.absoluteZM).toBeGreaterThanOrEqual(100_000);
      expect(final.difficulty).toBeGreaterThan(0.999);
      expect(laneCounts).toEqual(new Set([2, 3, 4]));
      // Exact moving-trajectory reservations and obstacle-free tapers still
      // reject some candidates from the bounded 31–41 m late-game cadence.
      // Both challenge kinds must nevertheless recur throughout the run.
      expect(clearedGates.size).toBeGreaterThan(40);
      expect(ordinaryEncounters.size).toBeGreaterThan(500);
      expect(steps).toBeLessThan(260_000);
      expect(maxFrontCars).toBeGreaterThan(0);
      expect(maxBuses).toBeGreaterThan(0);
      expect(maxRearCars).toBeLessThanOrEqual(4);
      expect(maxGroundCertificates).toBeGreaterThan(0);
    }
  }, 120_000);
});
