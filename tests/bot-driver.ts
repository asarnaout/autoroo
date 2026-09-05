import type {
  ChallengeCertificate,
  InputFrame,
  LaneIndex,
  RunSnapshot,
} from '../app/game/contracts';
import {
  FIXED_DT,
  LANE_COMMAND_INTERVAL_TICKS,
  LONGITUDINAL_MARGIN_M,
  PLAYER_LENGTH_M,
  VEHICLE_DIMENSIONS,
} from '../app/game/constants';
import { AutorooSimulation, gateJumpPressedAt } from '../app/game/simulation';

interface ManeuverPlanRow {
  readonly offsetM: number;
  readonly blockedLaneMask: number;
  readonly action: 'jump' | 'dodge';
  readonly targetLane: LaneIndex;
}

type CertificateWithManeuverPlan = ChallengeCertificate & {
  readonly maneuverPlan?: readonly ManeuverPlanRow[];
};

export const NO_CONTROLS: InputFrame = Object.freeze({
  laneDelta: 0,
  jumpPressed: false,
});

interface GroundRouteTarget {
  readonly certificate: ChallengeCertificate;
  readonly nearestZM: number;
}

function targetGroundRoute(
  simulation: AutorooSimulation,
  snapshot: RunSnapshot,
): GroundRouteTarget | null {
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
  const certificate = simulation
    .getGroundCertificates()
    .find((candidate) => candidate.blockerIds.includes(nearestId!));
  return certificate ? { certificate, nearestZM } : null;
}

function targetGroundCertificate(
  simulation: AutorooSimulation,
  snapshot: RunSnapshot,
): ChallengeCertificate | null {
  return targetGroundRoute(simulation, snapshot)?.certificate ?? null;
}

interface PlannedTarget {
  readonly lane: LaneIndex;
  readonly rowZM: number;
}

function currentPlannedTarget(
  certificate: ChallengeCertificate,
  snapshot: RunSnapshot,
): PlannedTarget {
  const plan = maneuverPlan(certificate);
  if (plan.length === 0)
    return { lane: certificate.targetLane, rowZM: Number.POSITIVE_INFINITY };
  const firstStartM = Math.min(
    ...certificate.blockerTrajectories.map((trajectory) => trajectory.startZM),
  );
  const elapsedTicks = Math.max(0, snapshot.tick - certificate.revealTick);
  const passExtentM =
    PLAYER_LENGTH_M / 2 +
    VEHICLE_DIMENSIONS[certificate.selectedVehicle].lengthM / 2 +
    LONGITUDINAL_MARGIN_M;

  for (let rowIndex = 0; rowIndex < plan.length; rowIndex += 1) {
    const row = plan[rowIndex];
    const rowStartM = firstStartM + row.offsetM;
    const trajectory = certificate.blockerTrajectories.find(
      (candidate) => Math.abs(candidate.startZM - rowStartM) < 0.001,
    );
    const rowZM = trajectory
      ? trajectory.startZM + trajectory.speedMps * elapsedTicks * FIXED_DT
      : rowStartM;
    if (rowZM + passExtentM < snapshot.player.absoluteZM) continue;
    return { lane: row.targetLane, rowZM };
  }
  return { lane: certificate.targetLane, rowZM: Number.POSITIVE_INFINITY };
}

function maneuverPlan(
  certificate: ChallengeCertificate,
): readonly ManeuverPlanRow[] {
  return (certificate as CertificateWithManeuverPlan).maneuverPlan ?? [];
}

export function certificateBotInput(
  simulation: AutorooSimulation,
  snapshot: RunSnapshot,
): InputFrame {
  const jump = snapshot.activeCertificate;
  if (jump) {
    const localTick = snapshot.tick - jump.revealTick;
    const plannedTarget = currentPlannedTarget(jump, snapshot);
    const groundTarget = targetGroundRoute(simulation, snapshot);
    const followingGround =
      groundTarget !== null && groundTarget.nearestZM < plannedTarget.rowZM;
    const targetLane = followingGround
      ? groundTarget.certificate.targetLane
      : plannedTarget.lane;
    let laneDelta: -1 | 0 | 1 = 0;
    if (
      (followingGround || localTick % LANE_COMMAND_INTERVAL_TICKS === 0) &&
      snapshot.player.lane !== targetLane &&
      snapshot.player.queuedLane !== targetLane
    ) {
      const commandOrigin = snapshot.player.queuedLane ?? snapshot.player.lane;
      laneDelta = commandOrigin < targetLane ? 1 : -1;
    }
    return {
      laneDelta,
      jumpPressed: gateJumpPressedAt(
        jump.maneuverPlan,
        jump.blockerTrajectories[0].speedMps,
        snapshot.tick,
        Math.floor((jump.safeTakeoffTickMin + jump.safeTakeoffTickMax) / 2),
      ),
    };
  }

  const ground = targetGroundCertificate(simulation, snapshot);
  if (
    ground &&
    snapshot.player.lane !== ground.targetLane &&
    snapshot.player.queuedLane !== ground.targetLane
  ) {
    if (snapshot.player.laneChangeDirection !== 0) return NO_CONTROLS;
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
    if (!laneChangeClear) return NO_CONTROLS;
    return {
      ...NO_CONTROLS,
      laneDelta: snapshot.player.lane < ground.targetLane ? 1 : -1,
    };
  }
  return NO_CONTROLS;
}
