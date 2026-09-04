import type {
  ChallengeCertificate,
  InputFrame,
  RunSnapshot,
} from '../app/game/contracts';
import { LANE_COMMAND_INTERVAL_TICKS } from '../app/game/constants';
import { AutorooSimulation } from '../app/game/simulation';

export const ACCELERATE_INPUT: InputFrame = Object.freeze({
  accelerate: true,
  brake: false,
  laneDelta: 0,
  jumpPressed: false,
});

function targetGroundCertificate(
  simulation: AutorooSimulation,
  snapshot: RunSnapshot,
): ChallengeCertificate | null {
  let nearestId: string | null = null;
  let nearestZM = Number.POSITIVE_INFINITY;
  for (const vehicle of snapshot.traffic) {
    const passExtentM = 1.8 + vehicle.lengthM / 2 + 0.25;
    if (
      vehicle.role === 'ordinary' &&
      vehicle.absoluteZM + passExtentM >= snapshot.player.absoluteZM &&
      vehicle.absoluteZM < nearestZM
    ) {
      nearestZM = vehicle.absoluteZM;
      nearestId = vehicle.id;
    }
  }
  if (nearestId === null || nearestZM - snapshot.player.absoluteZM > 180)
    return null;
  return (
    simulation
      .getGroundCertificates()
      .find((certificate) => certificate.blockerIds.includes(nearestId!)) ??
    null
  );
}

export function certificateBotInput(
  simulation: AutorooSimulation,
  snapshot: RunSnapshot,
): InputFrame {
  const jump = snapshot.activeCertificate;
  if (jump) {
    const localTick = snapshot.tick - jump.revealTick;
    let laneDelta: -1 | 0 | 1 = 0;
    if (
      localTick >= 45 &&
      localTick % LANE_COMMAND_INTERVAL_TICKS === 0 &&
      snapshot.player.lane !== jump.targetLane &&
      snapshot.player.queuedLane !== jump.targetLane
    ) {
      const commandOrigin = snapshot.player.queuedLane ?? snapshot.player.lane;
      laneDelta = commandOrigin < jump.targetLane ? 1 : -1;
    }
    return {
      accelerate: localTick >= 45,
      brake: false,
      laneDelta,
      jumpPressed:
        snapshot.tick ===
        Math.floor((jump.safeTakeoffTickMin + jump.safeTakeoffTickMax) / 2),
    };
  }

  const ground = targetGroundCertificate(simulation, snapshot);
  if (
    ground &&
    snapshot.player.lane !== ground.targetLane &&
    snapshot.player.queuedLane !== ground.targetLane
  ) {
    if (snapshot.player.laneChangeDirection !== 0) return ACCELERATE_INPUT;
    const nextLane = (
      snapshot.player.lane < ground.targetLane
        ? snapshot.player.lane + 1
        : snapshot.player.lane - 1
    ) as 0 | 1 | 2 | 3;
    const laneChangeClear = !snapshot.traffic.some(
      (vehicle) =>
        vehicle.lane === nextLane &&
        Math.abs(vehicle.absoluteZM - snapshot.player.absoluteZM) <=
          1.8 + vehicle.lengthM / 2 + 0.25,
    );
    if (!laneChangeClear) return ACCELERATE_INPUT;
    return {
      ...ACCELERATE_INPUT,
      laneDelta: snapshot.player.lane < ground.targetLane ? 1 : -1,
    };
  }
  return ACCELERATE_INPUT;
}
