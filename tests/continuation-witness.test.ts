import { expect, it } from 'vitest';
import {
  FIXED_DT,
  LANE_COMMAND_INTERVAL_TICKS,
  MAX_SPEED_MPS,
} from '../app/game/constants';
import { AutorooSimulation } from '../app/game/simulation';
import { certificateBotInput } from './bot-driver';

it('retains off-cadence jump inputs in continuation ground-route witnesses', () => {
  const simulation = new AutorooSimulation(7);
  const seenCertificates = new Set<string>();
  let verifiedCertificate = false;
  simulation.start();
  for (
    let step = 0;
    step < 3000 &&
    simulation.renderPlayer.absoluteZM < 1100 &&
    !verifiedCertificate;
    step += 1
  ) {
    const snapshot = simulation.snapshot();
    const gate = snapshot.activeCertificate;
    if (gate) {
      const firstJumpTick = Math.floor(
        (gate.safeTakeoffTickMin + gate.safeTakeoffTickMax) / 2,
      );
      const closingSpeedMps =
        MAX_SPEED_MPS - gate.blockerTrajectories[0].speedMps;
      const jumpTicks = gate.maneuverPlan
        .filter((row) => row.action === 'jump')
        .map(
          (row) =>
            firstJumpTick +
            Math.round(row.offsetM / closingSpeedMps / FIXED_DT),
        );
      for (const ground of simulation.getGroundCertificates()) {
        if (
          seenCertificates.has(ground.id) ||
          ground.revealTick < gate.revealTick
        )
          continue;
        seenCertificates.add(ground.id);
        const endTick = ground.witness.at(-1)!.tick;
        const expectedTicks = jumpTicks.filter(
          (tick) => tick >= ground.revealTick && tick <= endTick,
        );
        // A regularly sampled trace would accidentally pass if all jumps
        // happened to align with its six-tick sampling cadence.
        if (
          !expectedTicks.some(
            (tick) =>
              (tick - ground.revealTick) % LANE_COMMAND_INTERVAL_TICKS !== 0,
          )
        )
          continue;
        for (const tick of expectedTicks) {
          expect(
            ground.witness.some(
              (point) => point.tick === tick && point.input.jumpPressed,
            ),
            `${ground.id} omitted the certified jump input at tick ${tick}`,
          ).toBe(true);
        }
        verifiedCertificate = true;
        break;
      }
    }
    simulation.tick(certificateBotInput(simulation, snapshot));
    simulation.drainEvents();
    expect(simulation.phaseName).toBe('running');
  }
  expect(
    verifiedCertificate,
    'Production must exercise a continuation witness with an off-cadence jump',
  ).toBe(true);
});
