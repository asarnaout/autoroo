import {
  ACCELERATION_MPS2,
  BRAKING_MPS2,
  COAST_DRAG_MPS2,
  FIXED_DT,
  GATE_APPROACH_CLEAR_M,
  GATE_FORWARD_STEADY_M,
  GATE_LANDING_CLEAR_M,
  GATE_WITNESS_LIMIT_S,
  GRAVITY_MPS2,
  JUMP_FLIGHT_SECONDS,
  JUMP_IMPULSE_MPS,
  LANE_COMMAND_INTERVAL_TICKS,
  LANE_CHANGE_DURATION_S,
  LANE_X,
  LATERAL_COLLISION_MARGIN_M,
  LONGITUDINAL_MARGIN_M,
  MAX_SPEED_MPS,
  MIN_SPACE_WINDOW_S,
  MODULE_LENGTH_M,
  PLAYER_LENGTH_M,
  PLAYER_WIDTH_M,
  RENDER_POOL_LIMITS,
  TIMING_MARGIN_TICKS,
  VEHICLE_DIMENSIONS,
  VERTICAL_CLEARANCE_M,
  activeLanes,
  countLanes,
  difficultyAt,
  hasLane,
  lerp,
} from './constants';
import type {
  ChallengeCertificate,
  GameEvent,
  InputFrame,
  LaneIndex,
  PlayerState,
  RunPhase,
  RunSnapshot,
  TrafficVehicle,
  VehicleKind,
  WitnessTracePoint,
} from './contracts';
import {
  chooseEscapeLane,
  firstGateDistance,
  isSteadyRoadRange,
  laneMaskAt,
  nearestActiveLane,
  nextGateDistance,
  nextActiveLane,
  nextTaperStartM,
  nudgeGateToSteadyRoad,
  ordinaryGapM,
  roadModuleForDistance,
} from './generator';
import { hashParts, hashUnit, stableHash } from './random';

const FRONT_DRAW_M = 260;
const GATE_REVEAL_M = 205;
// Vehicles retire safely before the next taper and the production witness
// rejects any unsafe row, so this only needs to preserve a generous reaction
// corridor rather than the old worst-case 20-second trajectory distance.
const ORDINARY_FORWARD_STEADY_M = 80;

interface GroundRoute {
  certificate: ChallengeCertificate;
  encounterId: string;
  zM: number;
}

interface GateWindowMath {
  readonly feasible: boolean;
  readonly tLowS: number;
  readonly tHighS: number;
  readonly separationMinM: number;
  readonly separationMaxM: number;
  readonly minimumSpeedMps: number;
  readonly inputWindowS: number;
}

interface MutableRearState {
  slowTimeS: number;
  recoveryTimeS: number;
  rearPackActive: boolean;
  rearWarning: boolean;
}

interface MutableWorldState {
  readonly seed: number;
  tickNumber: number;
  player: PlayerState;
  traffic: TrafficVehicle[];
  bonusScore: number;
  rear: MutableRearState;
}

interface GateCandidate {
  readonly gateZM: number;
  readonly kind: VehicleKind;
  readonly blockerSpeedMps: number;
  readonly targetSpeedMps: number;
  readonly attempt: number;
  readonly rowOffsetsM: readonly number[];
}

interface WitnessResult {
  readonly success: boolean;
  readonly witness: readonly WitnessTracePoint[];
  readonly witnessTraceHash: string;
  readonly verticalClearanceM: number;
  readonly clearedAtTick: number;
}

interface PreparedGateReplays {
  readonly worlds: ReadonlyMap<number, MutableWorldState>;
  readonly prefixWitness: readonly WitnessTracePoint[];
}

const WORLD_JUMPED = 1 << 0;
const WORLD_CRASHED = 1 << 1;
const WORLD_REAR_SPAWNED = 1 << 2;
const WORLD_REAR_RETIRED = 1 << 3;
const MAX_PENDING_EVENTS = 64;
const MAX_WITNESS_TICKS = Math.round(GATE_WITNESS_LIMIT_S / FIXED_DT);
const TRANSITION_REAR_GRACE_S = 2;
const MAX_GATE_ROWS = 4;

function quantize(value: number): number {
  return Math.round(value * 1000);
}

function vehicleDimensions(kind: VehicleKind) {
  return VEHICLE_DIMENSIONS[kind];
}

function gateForwardReservationM(
  kind: VehicleKind,
  blockerSpeedMps: number,
  rowOffsetsM: readonly number[] = [0],
): number {
  const lastRowOffsetM = rowOffsetsM[rowOffsetsM.length - 1] ?? 0;
  return (
    lastRowOffsetM +
    Math.max(0, blockerSpeedMps) * GATE_WITNESS_LIMIT_S +
    GATE_LANDING_CLEAR_M +
    PLAYER_LENGTH_M / 2 +
    vehicleDimensions(kind).lengthM / 2 +
    LONGITUDINAL_MARGIN_M
  );
}

function normalizeGateRowOffsets(
  rowOffsetsM: readonly number[] | undefined,
): readonly number[] | null {
  const offsets = rowOffsetsM ?? [0];
  if (offsets.length === 0 || offsets.length > MAX_GATE_ROWS) return null;
  const normalized: number[] = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const offsetM = offsets[index];
    if (
      !Number.isFinite(offsetM) ||
      offsetM < 0 ||
      (index === 0 && Math.abs(offsetM) > 1e-9) ||
      (index > 0 && offsetM - normalized[index - 1] < 12)
    ) {
      return null;
    }
    normalized.push(offsetM);
  }
  if ((normalized.at(-1) ?? 0) > 90) return null;
  return Object.freeze(normalized);
}

/** Tight centres for blockers met at the same phase of consecutive auto-hops. */
export function jumpChainOffsetsM(
  rowCount: number,
  blockerSpeedMps: number,
  spacingScale = 1,
): readonly number[] {
  const count = Math.max(1, Math.min(MAX_GATE_ROWS, Math.floor(rowCount)));
  const relativeSpeedMps = Math.max(0, MAX_SPEED_MPS - blockerSpeedMps);
  const hopCycleS = Math.ceil(JUMP_FLIGHT_SECONDS / FIXED_DT) * FIXED_DT;
  const spacingM = relativeSpeedMps * hopCycleS * spacingScale;
  return Object.freeze(
    Array.from({ length: count }, (_, index) => index * spacingM),
  );
}

export function createTrafficVehicle(
  id: string,
  encounterId: string,
  kind: VehicleKind,
  role: TrafficVehicle['role'],
  lane: LaneIndex,
  absoluteZM: number,
  speedMps: number,
  certificateId: string | null = null,
  retireAtZM: number | null = null,
): TrafficVehicle {
  const dimensions = vehicleDimensions(kind);
  return {
    id,
    encounterId,
    kind,
    role,
    lane,
    absoluteZM,
    previousZM: absoluteZM,
    speedMps,
    ...dimensions,
    airborneOverlap: false,
    closePassOverlap: false,
    bonusAwarded: false,
    locked: role === 'gate',
    certificateId,
    retireAtZM,
  };
}

export function sweptOverlapInterval(
  playerPreviousZ: number,
  playerZ: number,
  vehiclePreviousZ: number,
  vehicleZ: number,
  halfExtentM: number,
): readonly [number, number] | null {
  const relativeStart = playerPreviousZ - vehiclePreviousZ;
  const relativeEnd = playerZ - vehicleZ;
  const delta = relativeEnd - relativeStart;
  if (Math.abs(delta) < 1e-9) {
    return Math.abs(relativeStart) <= halfExtentM ? [0, 1] : null;
  }
  const first = (-halfExtentM - relativeStart) / delta;
  const second = (halfExtentM - relativeStart) / delta;
  const entry = Math.max(0, Math.min(first, second));
  const exit = Math.min(1, Math.max(first, second));
  return entry <= exit ? [entry, exit] : null;
}

export function computeGateWindow(
  kind: VehicleKind,
  blockerSpeedMps: number,
  playerSpeedMps: number,
): GateWindowMath {
  const dimensions = vehicleDimensions(kind);
  const requiredHeight = dimensions.heightM + VERTICAL_CLEARANCE_M;
  const discriminant =
    JUMP_IMPULSE_MPS * JUMP_IMPULSE_MPS - 2 * GRAVITY_MPS2 * requiredHeight;
  if (discriminant <= 0) {
    return {
      feasible: false,
      tLowS: 0,
      tHighS: 0,
      separationMinM: 0,
      separationMaxM: 0,
      minimumSpeedMps: Number.POSITIVE_INFINITY,
      inputWindowS: 0,
    };
  }
  const root = Math.sqrt(discriminant);
  const tLowS =
    (JUMP_IMPULSE_MPS - root) / GRAVITY_MPS2 + TIMING_MARGIN_TICKS * FIXED_DT;
  const tHighS =
    (JUMP_IMPULSE_MPS + root) / GRAVITY_MPS2 - TIMING_MARGIN_TICKS * FIXED_DT;
  const halfExtentM =
    PLAYER_LENGTH_M / 2 + dimensions.lengthM / 2 + LONGITUDINAL_MARGIN_M;
  const availableS = tHighS - tLowS - MIN_SPACE_WINDOW_S;
  const minimumSpeedMps =
    availableS > 0
      ? blockerSpeedMps + (2 * halfExtentM) / availableS
      : Number.POSITIVE_INFINITY;
  const relativeSpeedMps = playerSpeedMps - blockerSpeedMps;
  const separationMinM = halfExtentM + relativeSpeedMps * tLowS;
  const separationMaxM = -halfExtentM + relativeSpeedMps * tHighS;
  const inputWindowS =
    relativeSpeedMps > 0
      ? (separationMaxM - separationMinM) / relativeSpeedMps
      : 0;
  return {
    feasible:
      minimumSpeedMps <= 28 &&
      playerSpeedMps >= minimumSpeedMps &&
      inputWindowS >= MIN_SPACE_WINDOW_S,
    tLowS,
    tHighS,
    separationMinM,
    separationMaxM,
    minimumSpeedMps,
    inputWindowS,
  };
}

export function advancePlayerPhysics(
  player: PlayerState,
  input: InputFrame,
): void {
  player.previousZM = player.absoluteZM;
  player.previousYM = player.yM;

  if (!player.airborne) {
    if (input.brake) {
      player.speedMps = Math.max(0, player.speedMps - BRAKING_MPS2 * FIXED_DT);
    } else if (input.accelerate) {
      player.speedMps = Math.min(
        MAX_SPEED_MPS,
        player.speedMps + ACCELERATION_MPS2 * FIXED_DT,
      );
    } else {
      player.speedMps = Math.max(
        0,
        player.speedMps - COAST_DRAG_MPS2 * FIXED_DT,
      );
    }
    if (input.jumpPressed) {
      player.airborne = true;
      player.takeoffSpeedMps = player.speedMps;
      player.jumpElapsedS = 0;
      player.verticalSpeedMps = JUMP_IMPULSE_MPS;
    }
  }

  const forwardSpeed = player.airborne
    ? player.takeoffSpeedMps
    : player.speedMps;
  player.absoluteZM += forwardSpeed * FIXED_DT;

  if (player.airborne) {
    player.jumpElapsedS += FIXED_DT;
    const elapsed = Math.min(player.jumpElapsedS, JUMP_FLIGHT_SECONDS);
    player.yM = Math.max(
      0,
      JUMP_IMPULSE_MPS * elapsed - 0.5 * GRAVITY_MPS2 * elapsed * elapsed,
    );
    player.verticalSpeedMps = JUMP_IMPULSE_MPS - GRAVITY_MPS2 * elapsed;
    if (player.jumpElapsedS >= JUMP_FLIGHT_SECONDS) {
      player.airborne = false;
      player.yM = 0;
      player.previousYM = Math.max(0, player.previousYM);
      player.verticalSpeedMps = 0;
      player.speedMps = player.takeoffSpeedMps;
    }
  }
  player.maxForwardM = Math.max(player.maxForwardM, player.absoluteZM);
}

function clonePlayer(player: PlayerState): PlayerState {
  return { ...player };
}

function cloneTraffic(vehicle: TrafficVehicle): TrafficVehicle {
  return { ...vehicle };
}

export function sweptVehicleOverlapInterval(
  player: PlayerState,
  vehicle: TrafficVehicle,
): readonly [number, number] | null {
  const longitudinalHalfExtentM =
    PLAYER_LENGTH_M / 2 + vehicle.lengthM / 2 + LONGITUDINAL_MARGIN_M;
  const longitudinal = sweptOverlapInterval(
    player.previousZM,
    player.absoluteZM,
    vehicle.previousZM,
    vehicle.absoluteZM,
    longitudinalHalfExtentM,
  );
  if (!longitudinal) return null;

  const vehicleXM = LANE_X[vehicle.lane];
  const lateralHalfExtentM =
    PLAYER_WIDTH_M / 2 + vehicle.widthM / 2 + LATERAL_COLLISION_MARGIN_M;
  const lateral = sweptOverlapInterval(
    player.previousXM,
    player.xM,
    vehicleXM,
    vehicleXM,
    lateralHalfExtentM,
  );
  if (!lateral) return null;

  const entry = Math.max(longitudinal[0], lateral[0]);
  const exit = Math.min(longitudinal[1], lateral[1]);
  return entry <= exit ? [entry, exit] : null;
}

export function collidesSwept(
  player: PlayerState,
  vehicle: TrafficVehicle,
): boolean {
  const interval = sweptVehicleOverlapInterval(player, vehicle);
  if (!interval) return false;
  const heightAtEntry = playerHeightDuringSweep(player, interval[0]);
  const heightAtExit = playerHeightDuringSweep(player, interval[1]);
  return (
    Math.min(heightAtEntry, heightAtExit) <
    vehicle.heightM + VERTICAL_CLEARANCE_M
  );
}

function playerHeightDuringSweep(player: PlayerState, alpha: number): number {
  if (player.previousYM === 0 && player.yM === 0) return 0;
  const rawEndElapsedS = player.jumpElapsedS;
  if (rawEndElapsedS <= 0) {
    return player.previousYM + (player.yM - player.previousYM) * alpha;
  }
  const startElapsedS = Math.max(0, rawEndElapsedS - FIXED_DT);
  const elapsedS = startElapsedS + FIXED_DT * alpha;
  if (elapsedS >= JUMP_FLIGHT_SECONDS) return 0;
  return Math.max(
    0,
    JUMP_IMPULSE_MPS * elapsedS - 0.5 * GRAVITY_MPS2 * elapsedS * elapsedS,
  );
}

function sweptVerticalClearanceM(
  player: PlayerState,
  vehicle: TrafficVehicle,
): number | null {
  const interval = sweptVehicleOverlapInterval(player, vehicle);
  if (!interval) return null;
  return (
    Math.min(
      playerHeightDuringSweep(player, interval[0]),
      playerHeightDuringSweep(player, interval[1]),
    ) - vehicle.heightM
  );
}

function chaseRearVehicles(
  rear: TrafficVehicle[],
  player: PlayerState,
  difficulty: number,
): void {
  const desiredClosingMps = Math.min(6, 3.8 + difficulty * 2.2);
  for (const vehicle of rear) {
    if (vehicle.role !== 'rear-pressure') continue;
    vehicle.previousZM = vehicle.absoluteZM;
    vehicle.speedMps = Math.max(
      vehicle.speedMps,
      player.speedMps + desiredClosingMps,
    );
    vehicle.speedMps = Math.min(player.speedMps + 6, vehicle.speedMps);
    vehicle.absoluteZM += vehicle.speedMps * FIXED_DT;
  }
}

function makePlayer(): PlayerState {
  return {
    lane: 1,
    xM: LANE_X[1],
    previousXM: LANE_X[1],
    laneChangeStartXM: LANE_X[1],
    laneChangeElapsedS: 0,
    laneChangeDirection: 0,
    queuedLane: null,
    absoluteZM: 0,
    previousZM: 0,
    yM: 0,
    previousYM: 0,
    speedMps: 0,
    verticalSpeedMps: 0,
    airborne: false,
    takeoffSpeedMps: 0,
    jumpElapsedS: 0,
    maxForwardM: 0,
  };
}

function exactNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  return Number.isFinite(value) ? value.toPrecision(17) : String(value);
}

function canonicalPlayer(
  player: PlayerState,
): readonly (number | string | boolean | null)[] {
  return [
    player.lane,
    exactNumber(player.xM),
    exactNumber(player.previousXM),
    exactNumber(player.laneChangeStartXM),
    exactNumber(player.laneChangeElapsedS),
    player.laneChangeDirection,
    player.queuedLane,
    exactNumber(player.absoluteZM),
    exactNumber(player.previousZM),
    exactNumber(player.yM),
    exactNumber(player.previousYM),
    exactNumber(player.speedMps),
    exactNumber(player.verticalSpeedMps),
    player.airborne,
    exactNumber(player.takeoffSpeedMps),
    exactNumber(player.jumpElapsedS),
    exactNumber(player.maxForwardM),
  ];
}

function canonicalTraffic(
  traffic: readonly TrafficVehicle[],
): readonly unknown[] {
  return [...traffic]
    .sort((first, second) =>
      first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
    )
    .map((vehicle) => [
      vehicle.id,
      vehicle.encounterId,
      vehicle.kind,
      vehicle.role,
      vehicle.lane,
      exactNumber(vehicle.absoluteZM),
      exactNumber(vehicle.previousZM),
      exactNumber(vehicle.speedMps),
      exactNumber(vehicle.lengthM),
      exactNumber(vehicle.widthM),
      exactNumber(vehicle.heightM),
      vehicle.airborneOverlap,
      vehicle.closePassOverlap,
      vehicle.bonusAwarded,
      vehicle.locked,
      vehicle.certificateId,
      vehicle.retireAtZM === null ? null : exactNumber(vehicle.retireAtZM),
    ]);
}

function canonicalCertificate(
  certificate: ChallengeCertificate,
): readonly unknown[] {
  return [
    certificate.version,
    certificate.id,
    certificate.kind,
    certificate.gateSeed,
    certificate.locked,
    certificate.revealTick,
    certificate.lockedStateHash,
    certificate.dependencyHash,
    certificate.targetLane,
    certificate.selectedVehicle,
    [...certificate.blockerIds],
    certificate.blockerTrajectories.map((trajectory) => [
      trajectory.id,
      trajectory.lane,
      trajectory.startTick,
      exactNumber(trajectory.startZM),
      exactNumber(trajectory.speedMps),
      trajectory.retireAtZM === null
        ? null
        : exactNumber(trajectory.retireAtZM),
    ]),
    certificate.safeTakeoffTickMin,
    certificate.safeTakeoffTickMax,
    exactNumber(certificate.minimumSpeedMps),
    exactNumber(certificate.targetSpeedMps),
    exactNumber(certificate.verticalClearanceM),
    exactNumber(certificate.longitudinalMarginM),
    certificate.timingMarginTicks,
    exactNumber(certificate.inputWindowS),
    certificate.witnessTraceHash,
    certificate.witness.map((point) => [
      point.tick,
      point.lane,
      point.xMM,
      point.zMM,
      point.yMM,
      point.speedMMps,
      point.input.accelerate,
      point.input.brake,
      point.input.laneDelta,
      point.input.jumpPressed,
    ]),
  ];
}

function canonicalEvent(event: GameEvent): readonly unknown[] {
  return event.type === 'bonus'
    ? [event.type, event.label, event.points]
    : [event.type];
}

function hashLockedWorld(world: MutableWorldState): string {
  return stableHash(
    JSON.stringify([
      world.seed,
      world.tickNumber,
      canonicalPlayer(world.player),
      canonicalTraffic(world.traffic),
      world.bonusScore,
      exactNumber(world.rear.slowTimeS),
      exactNumber(world.rear.recoveryTimeS),
      world.rear.rearPackActive,
      world.rear.rearWarning,
    ]),
  );
}

function stateDependencyHash(
  world: MutableWorldState,
  candidate: GateCandidate,
  trajectories: ChallengeCertificate['blockerTrajectories'],
): string {
  const firstModule = Math.floor(
    Math.max(0, candidate.gateZM - GATE_APPROACH_CLEAR_M) / MODULE_LENGTH_M,
  );
  const lastModule = Math.floor(
    Math.max(
      0,
      candidate.gateZM +
        gateForwardReservationM(
          candidate.kind,
          candidate.blockerSpeedMps,
          candidate.rowOffsetsM,
        ),
    ) / MODULE_LENGTH_M,
  );
  const road: unknown[] = [];
  for (let index = firstModule; index <= lastModule; index += 1) {
    const roadModule = roadModuleForDistance(
      world.seed,
      index * MODULE_LENGTH_M,
    );
    road.push([
      roadModule.index,
      roadModule.fromLaneMask,
      roadModule.toLaneMask,
      roadModule.transition?.kind ?? null,
      roadModule.transition?.lane ?? null,
    ]);
  }
  return stableHash(
    JSON.stringify([
      hashLockedWorld(world),
      lateralRulesFingerprint(),
      exactNumber(candidate.gateZM),
      candidate.kind,
      exactNumber(candidate.blockerSpeedMps),
      exactNumber(candidate.targetSpeedMps),
      candidate.rowOffsetsM.map(exactNumber),
      road,
      trajectories.map((trajectory) => [
        trajectory.id,
        trajectory.lane,
        trajectory.startTick,
        exactNumber(trajectory.startZM),
        exactNumber(trajectory.speedMps),
        trajectory.retireAtZM === null
          ? null
          : exactNumber(trajectory.retireAtZM),
      ]),
    ]),
  );
}

function lateralRulesFingerprint(): readonly string[] {
  return [
    'lateral-rules-v1',
    exactNumber(PLAYER_WIDTH_M),
    exactNumber(LATERAL_COLLISION_MARGIN_M),
    exactNumber(LANE_CHANGE_DURATION_S),
    String(LANE_COMMAND_INTERVAL_TICKS),
  ];
}

function cloneWorld(world: MutableWorldState): MutableWorldState {
  return {
    seed: world.seed,
    tickNumber: world.tickNumber,
    player: clonePlayer(world.player),
    traffic: world.traffic.map(cloneTraffic),
    bonusScore: world.bonusScore,
    rear: { ...world.rear },
  };
}

function beginLaneChange(player: PlayerState, destination: LaneIndex): void {
  const targetXM = LANE_X[destination];
  player.lane = destination;
  player.laneChangeStartXM = player.xM;
  player.laneChangeElapsedS = 0;
  if (Math.abs(targetXM - player.xM) < 1e-9) {
    player.xM = targetXM;
    player.laneChangeDirection = 0;
    return;
  }
  player.laneChangeDirection = targetXM > player.xM ? 1 : -1;
}

function beginQueuedLaneStep(player: PlayerState, mask: number): void {
  const queuedLane = player.queuedLane;
  if (queuedLane === null) return;
  if (!hasLane(mask, queuedLane)) {
    player.queuedLane = null;
    return;
  }
  if (queuedLane === player.lane) {
    player.queuedLane = null;
    return;
  }
  const delta = queuedLane > player.lane ? 1 : -1;
  const destination = nextActiveLane(mask, player.lane, delta);
  if (destination === player.lane) {
    player.queuedLane = null;
    return;
  }
  if (destination === queuedLane) player.queuedLane = null;
  beginLaneChange(player, destination);
}

export function isPlayerCenteredInLane(
  player: Readonly<PlayerState>,
  lane: LaneIndex = player.lane,
): boolean {
  return (
    player.laneChangeDirection === 0 &&
    player.queuedLane === null &&
    Math.abs(player.xM - LANE_X[lane]) < 1e-9
  );
}

function applyInputLane(
  player: PlayerState,
  input: InputFrame,
  seed: number,
): void {
  player.previousXM = player.xM;
  const mask = laneMaskAt(seed, player.absoluteZM);
  if (input.laneDelta !== 0) {
    if (player.laneChangeDirection === 0) {
      const destination = nextActiveLane(mask, player.lane, input.laneDelta);
      if (destination !== player.lane) beginLaneChange(player, destination);
    } else {
      const queueOrigin = player.queuedLane ?? player.lane;
      const queuedDestination = nextActiveLane(
        mask,
        queueOrigin,
        input.laneDelta,
      );
      player.queuedLane =
        queuedDestination === player.lane ? null : queuedDestination;
    }
  }

  if (player.laneChangeDirection === 0) return;
  player.laneChangeElapsedS = Math.min(
    LANE_CHANGE_DURATION_S,
    player.laneChangeElapsedS + FIXED_DT,
  );
  const progress = player.laneChangeElapsedS / LANE_CHANGE_DURATION_S;
  const eased = progress * progress * (3 - 2 * progress);
  player.xM = lerp(player.laneChangeStartXM, LANE_X[player.lane], eased);
  if (player.laneChangeElapsedS + 1e-12 < LANE_CHANGE_DURATION_S) return;

  player.xM = LANE_X[player.lane];
  player.laneChangeStartXM = player.xM;
  player.laneChangeElapsedS = 0;
  player.laneChangeDirection = 0;
  beginQueuedLaneStep(player, mask);
}

function enforceActiveLaneTarget(player: PlayerState, mask: number): void {
  if (player.queuedLane !== null && !hasLane(mask, player.queuedLane))
    player.queuedLane = null;
  if (hasLane(mask, player.lane)) return;
  player.queuedLane = null;
  beginLaneChange(player, nearestActiveLane(mask, player.lane));
}

function spawnRearPackInto(world: MutableWorldState): void {
  const lanes = activeLanes(laneMaskAt(world.seed, world.player.absoluteZM));
  const encounterId = `rear-${world.tickNumber}`;
  for (const lane of lanes.slice(0, RENDER_POOL_LIMITS.rearCars)) {
    world.traffic.push(
      createTrafficVehicle(
        `${encounterId}-${lane}`,
        encounterId,
        'sedan',
        'rear-pressure',
        lane,
        world.player.absoluteZM - 36,
        world.player.speedMps + 6,
      ),
    );
  }
  world.rear.rearPackActive = true;
  world.rear.rearWarning = true;
  world.rear.recoveryTimeS = 0;
}

function updateRearPressureState(world: MutableWorldState): number {
  const difficulty = difficultyAt(world.player.maxForwardM);
  const lowThreshold = lerp(6, 14, difficulty);
  const delayS = lerp(8, 5, difficulty);
  const recoveryThreshold = lerp(8, 18, difficulty);
  const transition =
    roadModuleForDistance(world.seed, world.player.absoluteZM).transition !==
    null;

  if (!world.rear.rearPackActive) {
    if (world.player.speedMps < lowThreshold) world.rear.slowTimeS += FIXED_DT;
    else world.rear.slowTimeS = 0;
    world.rear.rearWarning = world.rear.slowTimeS >= Math.max(0, delayS - 2);
    const transitionGraceElapsed =
      world.rear.slowTimeS >= delayS + TRANSITION_REAR_GRACE_S;
    if (
      world.rear.slowTimeS >= delayS &&
      (!transition || transitionGraceElapsed)
    ) {
      spawnRearPackInto(world);
      return WORLD_REAR_SPAWNED;
    }
    return 0;
  }

  world.rear.rearWarning = true;
  if (world.player.speedMps >= recoveryThreshold)
    world.rear.recoveryTimeS += FIXED_DT;
  else world.rear.recoveryTimeS = 0;
  if (world.rear.recoveryTimeS < 1) return 0;
  for (let index = world.traffic.length - 1; index >= 0; index -= 1) {
    if (world.traffic[index].role === 'rear-pressure')
      world.traffic.splice(index, 1);
  }
  world.rear.rearPackActive = false;
  world.rear.rearWarning = false;
  world.rear.slowTimeS = 0;
  world.rear.recoveryTimeS = 0;
  return WORLD_REAR_RETIRED;
}

/** Shared player/traffic/rear transition used by live play and witnesses. */
function stepWorld(world: MutableWorldState, input: InputFrame): number {
  applyInputLane(world.player, input, world.seed);
  const wasAirborne = world.player.airborne;
  advancePlayerPhysics(world.player, input);
  let outcome = !wasAirborne && world.player.airborne ? WORLD_JUMPED : 0;

  for (const vehicle of world.traffic) {
    if (vehicle.role === 'rear-pressure') continue;
    vehicle.previousZM = vehicle.absoluteZM;
    const nextZM = vehicle.absoluteZM + vehicle.speedMps * FIXED_DT;
    vehicle.absoluteZM =
      vehicle.retireAtZM === null
        ? nextZM
        : Math.min(nextZM, vehicle.retireAtZM);
  }
  chaseRearVehicles(
    world.traffic,
    world.player,
    difficultyAt(world.player.maxForwardM),
  );

  const newMask = laneMaskAt(world.seed, world.player.absoluteZM);
  enforceActiveLaneTarget(world.player, newMask);

  for (const vehicle of world.traffic) {
    if (collidesSwept(world.player, vehicle)) {
      outcome |= WORLD_CRASHED;
      world.tickNumber += 1;
      return outcome;
    }
  }
  outcome |= updateRearPressureState(world);
  world.tickNumber += 1;
  return outcome;
}

/** Retires certified trajectories after their final swept collision/score step. */
function retireCompletedOrdinaryTrajectories(world: MutableWorldState): void {
  for (let index = world.traffic.length - 1; index >= 0; index -= 1) {
    const vehicle = world.traffic[index];
    if (
      vehicle.role === 'ordinary' &&
      vehicle.retireAtZM !== null &&
      vehicle.absoluteZM >= vehicle.retireAtZM
    ) {
      world.traffic.splice(index, 1);
    }
  }
}

function witnessInput(
  player: PlayerState,
  targetLane: LaneIndex,
  localTick: number,
  jumpTick: number | null,
  holdJump = false,
): InputFrame {
  let laneDelta: -1 | 0 | 1 = 0;
  if (
    localTick >= 45 &&
    localTick % LANE_COMMAND_INTERVAL_TICKS === 0 &&
    player.lane !== targetLane &&
    player.queuedLane !== targetLane
  ) {
    const commandOrigin = player.queuedLane ?? player.lane;
    laneDelta = commandOrigin < targetLane ? 1 : -1;
  }
  return {
    // Target speeds are player guidance; full acceleration provides the
    // reaction margin needed to clear a moving gate within twenty seconds.
    accelerate: localTick >= 45,
    brake: false,
    laneDelta,
    jumpPressed:
      jumpTick !== null &&
      (jumpTick === localTick || (holdJump && localTick >= jumpTick)),
  };
}

function traceHash(witness: readonly WitnessTracePoint[]): string {
  return stableHash(
    witness
      .map(
        (point) =>
          `${point.tick},${point.lane},${point.xMM},${point.zMM},${point.yMM},${point.speedMMps},${Number(point.input.accelerate)},${Number(point.input.brake)},${point.input.laneDelta},${Number(point.input.jumpPressed)}`,
      )
      .join('|'),
  );
}

function freezeCertificate(
  certificate: ChallengeCertificate,
): ChallengeCertificate {
  for (const trajectory of certificate.blockerTrajectories)
    Object.freeze(trajectory);
  Object.freeze(certificate.blockerTrajectories);
  for (const point of certificate.witness) {
    Object.freeze(point.input);
    Object.freeze(point);
  }
  Object.freeze(certificate.witness);
  Object.freeze(certificate.blockerIds);
  return Object.freeze(certificate);
}

function certifyGate(
  seed: number,
  tick: number,
  player: PlayerState,
  traffic: readonly TrafficVehicle[],
  slowTimeS: number,
  recoveryTimeS: number,
  rearPackActive: boolean,
  rearWarning: boolean,
  bonusScore: number,
  gateZM: number,
  kind: VehicleKind,
  blockerSpeedMps: number,
  targetSpeedMps: number,
  attempt: number,
  rowOffsetsM: readonly number[] | undefined,
): ChallengeCertificate | null {
  const normalizedRowOffsetsM = normalizeGateRowOffsets(rowOffsetsM);
  if (normalizedRowOffsetsM === null) return null;
  const candidate: GateCandidate = {
    gateZM,
    kind,
    blockerSpeedMps,
    targetSpeedMps,
    attempt,
    rowOffsetsM: normalizedRowOffsetsM,
  };
  const revealWorld: MutableWorldState = {
    seed,
    tickNumber: tick,
    player: clonePlayer(player),
    traffic: traffic.map(cloneTraffic),
    bonusScore,
    rear: {
      slowTimeS,
      recoveryTimeS,
      rearPackActive,
      rearWarning,
    },
  };
  const forwardReservationM = gateForwardReservationM(
    kind,
    blockerSpeedMps,
    candidate.rowOffsetsM,
  );
  if (forwardReservationM > GATE_FORWARD_STEADY_M) return null;
  if (
    !Number.isFinite(gateZM) ||
    !Number.isFinite(blockerSpeedMps) ||
    blockerSpeedMps < 0 ||
    !Number.isFinite(targetSpeedMps) ||
    targetSpeedMps < 0 ||
    targetSpeedMps > MAX_SPEED_MPS ||
    !isSteadyRoadRange(
      seed,
      gateZM - GATE_APPROACH_CLEAR_M,
      gateZM + forwardReservationM,
    ) ||
    !gateReservationIsClear(traffic, gateZM, forwardReservationM)
  ) {
    return null;
  }
  const targetMath = computeGateWindow(kind, blockerSpeedMps, targetSpeedMps);
  if (!targetMath.feasible || targetMath.minimumSpeedMps > 28) return null;

  const gateMask = laneMaskAt(seed, gateZM);
  const lanes = activeLanes(gateMask);
  const targetLanes = [...lanes].sort((first, second) => {
    const distance =
      Math.abs(LANE_X[first] - player.xM) -
      Math.abs(LANE_X[second] - player.xM);
    return distance === 0 ? first - second : distance;
  });
  const blockers = makeGateBlockers(revealWorld, candidate, lanes);
  const trajectories = blockers.map((blocker) => ({
    id: blocker.id,
    lane: blocker.lane,
    startTick: tick,
    startZM: blocker.absoluteZM,
    speedMps: blocker.speedMps,
    retireAtZM: null,
  }));
  const requiredTickSpan = Math.ceil(MIN_SPACE_WINDOW_S / FIXED_DT);

  for (const targetLane of targetLanes) {
    const plausibleTicks = plausibleTakeoffTicks(
      revealWorld,
      candidate,
      targetLane,
    );
    for (let index = 0; index < plausibleTicks.length;) {
      const runStart = plausibleTicks[index];
      let runEnd = runStart;
      while (
        index + 1 < plausibleTicks.length &&
        plausibleTicks[index + 1] === runEnd + 1
      ) {
        index += 1;
        runEnd = plausibleTicks[index];
      }
      index += 1;
      if (runEnd - runStart < requiredTickSpan) continue;

      // Advertise exactly the human-tolerant minimum span. The surrounding
      // analytic window remains useful for placement, but proving extra input
      // ticks would add synchronous work to the reveal frame without improving
      // the contract.
      const certifiedStart =
        candidate.rowOffsetsM.length > 1
          ? Math.floor((runStart + runEnd - requiredTickSpan) / 2)
          : runStart;
      const certifiedEnd =
        candidate.rowOffsetsM.length > 1
          ? certifiedStart + requiredTickSpan
          : runEnd;
      const jumpTick = Math.floor((certifiedStart + certifiedEnd) / 2);
      // Repeated land/re-takeoff cycles are discrete, so a multi-row chain may
      // not be monotonic between its analytic endpoints. Replay every advertised
      // initial press tick before locking the challenge.
      let certifiedClearanceM = Number.POSITIVE_INFINITY;
      let allTakeoffTicksPass = true;
      const replayTicks =
        candidate.rowOffsetsM.length > 1
          ? Array.from(
              { length: certifiedEnd - certifiedStart + 1 },
              (_, replayIndex) => certifiedStart + replayIndex,
            )
          : [certifiedStart, certifiedEnd];
      const preparedReplays =
        candidate.rowOffsetsM.length > 1
          ? prepareGateReplayWorlds(
              revealWorld,
              candidate,
              targetLane,
              replayTicks,
              jumpTick,
            )
          : null;
      const blockerIds = new Set(blockers.map((blocker) => blocker.id));
      let selectedReplay: WitnessResult | null = null;
      for (const replayTick of replayTicks) {
        const preparedWorld = preparedReplays?.worlds.get(replayTick);
        let replay = preparedWorld
          ? continueGateWitness(
              preparedWorld,
              preparedWorld.traffic.filter((vehicle) =>
                blockerIds.has(vehicle.id),
              ),
              candidate,
              targetLane,
              replayTick,
              replayTick,
              replayTick === jumpTick,
            )
          : simulateGateWitness(
              revealWorld,
              candidate,
              targetLane,
              replayTick,
              false,
            );
        if (replayTick === jumpTick && preparedReplays) {
          const witness = [...preparedReplays.prefixWitness, ...replay.witness];
          replay = {
            ...replay,
            witness,
            witnessTraceHash: traceHash(witness),
          };
          selectedReplay = replay;
        }
        if (!replay.success) {
          allTakeoffTicksPass = false;
          break;
        }
        certifiedClearanceM = Math.min(
          certifiedClearanceM,
          replay.verticalClearanceM,
        );
      }
      if (!allTakeoffTicksPass) continue;
      selectedReplay ??= simulateGateWitness(
        revealWorld,
        candidate,
        targetLane,
        jumpTick,
        true,
      );
      if (!selectedReplay.success) continue;

      const lockedStateHash = hashLockedWorld(revealWorld);
      const dependencyHash = stateDependencyHash(
        revealWorld,
        candidate,
        trajectories,
      );
      return freezeCertificate({
        version: 1,
        id: `jump-${tick}-${attempt}-${stableHash(`${seed}:${gateZM}`).slice(0, 6)}`,
        kind: 'jump',
        gateSeed: hashParts(seed, tick, attempt, quantize(gateZM)),
        locked: true,
        revealTick: tick,
        lockedStateHash,
        dependencyHash,
        targetLane,
        selectedVehicle: kind,
        blockerIds: blockers.map((blocker) => blocker.id),
        blockerTrajectories: trajectories,
        safeTakeoffTickMin: tick + certifiedStart,
        safeTakeoffTickMax: tick + certifiedEnd,
        minimumSpeedMps: targetMath.minimumSpeedMps,
        targetSpeedMps,
        verticalClearanceM: Math.min(
          certifiedClearanceM,
          selectedReplay.verticalClearanceM,
        ),
        longitudinalMarginM: LONGITUDINAL_MARGIN_M,
        timingMarginTicks: TIMING_MARGIN_TICKS,
        inputWindowS: (certifiedEnd - certifiedStart) * FIXED_DT,
        witnessTraceHash: selectedReplay.witnessTraceHash,
        witness: selectedReplay.witness,
      });
    }
  }
  return null;
}

function gateReservationIsClear(
  traffic: readonly TrafficVehicle[],
  gateZM: number,
  forwardReservationM: number,
): boolean {
  const startM = gateZM - GATE_APPROACH_CLEAR_M;
  const endM = gateZM + forwardReservationM;
  return !traffic.some(
    (vehicle) =>
      vehicle.role === 'ordinary' &&
      Math.max(vehicle.previousZM, vehicle.absoluteZM) >= startM &&
      Math.min(vehicle.previousZM, vehicle.absoluteZM) <= endM,
  );
}

function makeGateBlockers(
  world: MutableWorldState,
  candidate: GateCandidate,
  lanes: readonly LaneIndex[],
): TrafficVehicle[] {
  const blockers: TrafficVehicle[] = [];
  for (
    let rowIndex = 0;
    rowIndex < candidate.rowOffsetsM.length;
    rowIndex += 1
  ) {
    const rowZM = candidate.gateZM + candidate.rowOffsetsM[rowIndex];
    const encounterId = `gate-${world.tickNumber}-${candidate.attempt}-${rowIndex}`;
    for (const lane of lanes) {
      blockers.push(
        createTrafficVehicle(
          `${encounterId}-${lane}`,
          encounterId,
          candidate.kind,
          'gate',
          lane,
          rowZM,
          candidate.blockerSpeedMps,
        ),
      );
    }
  }
  return blockers;
}

function plausibleTakeoffTicks(
  revealWorld: MutableWorldState,
  candidate: GateCandidate,
  targetLane: LaneIndex,
): number[] {
  const player = clonePlayer(revealWorld.player);
  const result: number[] = [];
  for (let localTick = 0; localTick < MAX_WITNESS_TICKS; localTick += 1) {
    const input = witnessInput(player, targetLane, localTick, null);
    applyInputLane(player, input, revealWorld.seed);
    if (!player.airborne && isPlayerCenteredInLane(player, targetLane)) {
      const preview = clonePlayer(player);
      advancePlayerPhysics(preview, { ...input, jumpPressed: true });
      const blockerZM =
        candidate.gateZM + candidate.blockerSpeedMps * localTick * FIXED_DT;
      const math = computeGateWindow(
        candidate.kind,
        candidate.blockerSpeedMps,
        preview.takeoffSpeedMps,
      );
      const separationM = blockerZM - player.absoluteZM;
      if (
        math.feasible &&
        preview.takeoffSpeedMps >= candidate.targetSpeedMps - 0.001 &&
        separationM >= math.separationMinM &&
        separationM <= math.separationMaxM
      ) {
        result.push(localTick);
      }
    }
    advancePlayerPhysics(player, input);
    const mask = laneMaskAt(revealWorld.seed, player.absoluteZM);
    enforceActiveLaneTarget(player, mask);
    const blockerZM =
      candidate.gateZM + candidate.blockerSpeedMps * (localTick + 1) * FIXED_DT;
    if (player.absoluteZM > blockerZM + 100) break;
  }
  return result;
}

function prepareGateReplayWorlds(
  revealWorld: MutableWorldState,
  candidate: GateCandidate,
  targetLane: LaneIndex,
  replayTicks: readonly number[],
  traceUntilTick: number,
): PreparedGateReplays {
  const wantedTicks = new Set(replayTicks);
  const lastWantedTick = Math.max(...replayTicks);
  const world = cloneWorld(revealWorld);
  const blockers = makeGateBlockers(
    world,
    candidate,
    activeLanes(laneMaskAt(world.seed, candidate.gateZM)),
  );
  world.traffic.push(...blockers);
  const prepared = new Map<number, MutableWorldState>();
  const prefixWitness: WitnessTracePoint[] = [];

  for (let localTick = 0; localTick <= lastWantedTick; localTick += 1) {
    if (wantedTicks.has(localTick)) prepared.set(localTick, cloneWorld(world));
    if (localTick === lastWantedTick) break;
    const input = witnessInput(world.player, targetLane, localTick, null);
    const inputTick = world.tickNumber;
    const outcome = stepWorld(world, input);
    if (
      localTick < traceUntilTick &&
      localTick % LANE_COMMAND_INTERVAL_TICKS === 0
    ) {
      prefixWitness.push({
        tick: inputTick,
        lane: world.player.lane,
        xMM: quantize(world.player.xM),
        zMM: quantize(world.player.absoluteZM),
        yMM: quantize(world.player.yM),
        speedMMps: quantize(world.player.speedMps),
        input: { ...input },
      });
    }
    if ((outcome & WORLD_CRASHED) !== 0) break;
    retireCompletedOrdinaryTrajectories(world);
  }
  return { worlds: prepared, prefixWitness };
}

function continueGateWitness(
  world: MutableWorldState,
  blockers: readonly TrafficVehicle[],
  candidate: GateCandidate,
  targetLane: LaneIndex,
  jumpTick: number,
  startLocalTick: number,
  recordTrace: boolean,
): WitnessResult {
  const witness: WitnessTracePoint[] = [];
  let minimumVerticalClearanceM = Number.POSITIVE_INFINITY;

  for (
    let localTick = startLocalTick;
    localTick < MAX_WITNESS_TICKS;
    localTick += 1
  ) {
    const input = witnessInput(
      world.player,
      targetLane,
      localTick,
      jumpTick,
      candidate.rowOffsetsM.length > 1,
    );
    const inputTick = world.tickNumber;
    const outcome = stepWorld(world, input);
    for (const blocker of blockers) {
      const clearanceM = sweptVerticalClearanceM(world.player, blocker);
      if (clearanceM !== null) {
        minimumVerticalClearanceM = Math.min(
          minimumVerticalClearanceM,
          clearanceM,
        );
      }
    }
    if (
      recordTrace &&
      (localTick % LANE_COMMAND_INTERVAL_TICKS === 0 || localTick === jumpTick)
    ) {
      witness.push({
        tick: inputTick,
        lane: world.player.lane,
        xMM: quantize(world.player.xM),
        zMM: quantize(world.player.absoluteZM),
        yMM: quantize(world.player.yM),
        speedMMps: quantize(world.player.speedMps),
        input: { ...input },
      });
    }
    if ((outcome & WORLD_CRASHED) !== 0) {
      return {
        success: false,
        witness,
        witnessTraceHash: traceHash(witness),
        verticalClearanceM: minimumVerticalClearanceM,
        clearedAtTick: world.tickNumber,
      };
    }
    retireCompletedOrdinaryTrajectories(world);
    const passedLandingZone = blockers.every(
      (blocker) =>
        world.player.absoluteZM >
        blocker.absoluteZM +
          PLAYER_LENGTH_M / 2 +
          blocker.lengthM / 2 +
          LONGITUDINAL_MARGIN_M +
          GATE_LANDING_CLEAR_M,
    );
    if (passedLandingZone && !world.player.airborne) {
      const success = minimumVerticalClearanceM >= VERTICAL_CLEARANCE_M;
      return {
        success,
        witness,
        witnessTraceHash: traceHash(witness),
        verticalClearanceM: minimumVerticalClearanceM,
        clearedAtTick: world.tickNumber,
      };
    }
  }
  return {
    success: false,
    witness,
    witnessTraceHash: traceHash(witness),
    verticalClearanceM: minimumVerticalClearanceM,
    clearedAtTick: world.tickNumber,
  };
}

function simulateGateWitness(
  revealWorld: MutableWorldState,
  candidate: GateCandidate,
  targetLane: LaneIndex,
  jumpTick: number,
  recordTrace: boolean,
): WitnessResult {
  const world = cloneWorld(revealWorld);
  const blockers = makeGateBlockers(
    world,
    candidate,
    activeLanes(laneMaskAt(world.seed, candidate.gateZM)),
  );
  world.traffic.push(...blockers);
  return continueGateWitness(
    world,
    blockers,
    candidate,
    targetLane,
    jumpTick,
    0,
    recordTrace,
  );
}

function simulateGroundWitness(
  revealWorld: MutableWorldState,
  draftedBlockers: readonly TrafficVehicle[],
  routeTargets: ReadonlyMap<string, LaneIndex>,
): WitnessResult {
  const world = cloneWorld(revealWorld);
  const blockerIds = new Set(draftedBlockers.map((vehicle) => vehicle.id));
  const passedBlockerIds = new Set<string>();
  world.traffic.push(...draftedBlockers.map(cloneTraffic));
  const witness: WitnessTracePoint[] = [];

  for (let localTick = 0; localTick < MAX_WITNESS_TICKS; localTick += 1) {
    let desiredLane = world.player.lane;
    let nearest: TrafficVehicle | null = null;
    for (const vehicle of world.traffic) {
      if (vehicle.role !== 'ordinary') continue;
      const passExtent =
        PLAYER_LENGTH_M / 2 + vehicle.lengthM / 2 + LONGITUDINAL_MARGIN_M;
      if (vehicle.absoluteZM + passExtent < world.player.absoluteZM) continue;
      if (nearest === null || vehicle.absoluteZM < nearest.absoluteZM)
        nearest = vehicle;
    }
    if (nearest)
      desiredLane = routeTargets.get(nearest.encounterId) ?? desiredLane;
    const mask = laneMaskAt(world.seed, world.player.absoluteZM);
    if (!hasLane(mask, desiredLane))
      desiredLane = nearestActiveLane(mask, desiredLane);
    let laneDelta: -1 | 0 | 1 = 0;
    if (
      localTick >= 45 &&
      localTick % LANE_COMMAND_INTERVAL_TICKS === 0 &&
      world.player.lane !== desiredLane &&
      world.player.queuedLane !== desiredLane
    ) {
      const commandOrigin = world.player.queuedLane ?? world.player.lane;
      laneDelta = commandOrigin < desiredLane ? 1 : -1;
    }
    const input: InputFrame = {
      accelerate: localTick >= 45,
      brake: false,
      laneDelta,
      jumpPressed: false,
    };
    const inputTick = world.tickNumber;
    const outcome = stepWorld(world, input);
    if (localTick % LANE_COMMAND_INTERVAL_TICKS === 0 || laneDelta !== 0) {
      witness.push({
        tick: inputTick,
        lane: world.player.lane,
        xMM: quantize(world.player.xM),
        zMM: quantize(world.player.absoluteZM),
        yMM: quantize(world.player.yM),
        speedMMps: quantize(world.player.speedMps),
        input: { ...input },
      });
    }
    if ((outcome & WORLD_CRASHED) !== 0) {
      return {
        success: false,
        witness,
        witnessTraceHash: traceHash(witness),
        verticalClearanceM: 0,
        clearedAtTick: world.tickNumber,
      };
    }
    for (const vehicle of world.traffic) {
      if (!blockerIds.has(vehicle.id)) continue;
      const physicallyPassed =
        world.player.absoluteZM >
        vehicle.absoluteZM +
          PLAYER_LENGTH_M / 2 +
          vehicle.lengthM / 2 +
          LONGITUDINAL_MARGIN_M;
      if (physicallyPassed) passedBlockerIds.add(vehicle.id);
      else if (
        vehicle.retireAtZM !== null &&
        vehicle.absoluteZM >= vehicle.retireAtZM
      ) {
        // A proof may not become vacuously successful because an unseen
        // blocker reached its immutable taper retirement boundary first.
        return {
          success: false,
          witness,
          witnessTraceHash: traceHash(witness),
          verticalClearanceM: 0,
          clearedAtTick: world.tickNumber,
        };
      }
    }
    retireCompletedOrdinaryTrajectories(world);
    if (passedBlockerIds.size === blockerIds.size) {
      return {
        success: true,
        witness,
        witnessTraceHash: traceHash(witness),
        verticalClearanceM: 0,
        clearedAtTick: world.tickNumber,
      };
    }
  }
  return {
    success: false,
    witness,
    witnessTraceHash: traceHash(witness),
    verticalClearanceM: 0,
    clearedAtTick: world.tickNumber,
  };
}

export interface GateCertificationRequest {
  readonly seed: number;
  readonly tick?: number;
  readonly player: PlayerState;
  readonly traffic?: readonly TrafficVehicle[];
  readonly slowTimeS?: number;
  readonly recoveryTimeS?: number;
  readonly rearPackActive?: boolean;
  readonly rearWarning?: boolean;
  readonly bonusScore?: number;
  readonly gateZM: number;
  readonly kind: VehicleKind;
  readonly blockerSpeedMps: number;
  readonly targetSpeedMps: number;
  readonly attempt?: number;
  /** Full-lane row centres relative to gateZM; the first row is always zero. */
  readonly rowOffsetsM?: readonly number[];
}

export function certifyJumpGate(
  request: GateCertificationRequest,
): ChallengeCertificate | null {
  return certifyGate(
    request.seed >>> 0,
    request.tick ?? 0,
    clonePlayer(request.player),
    request.traffic ?? [],
    request.slowTimeS ?? 0,
    request.recoveryTimeS ?? 0,
    request.rearPackActive ??
      request.traffic?.some((vehicle) => vehicle.role === 'rear-pressure') ??
      false,
    request.rearWarning ?? false,
    request.bonusScore ?? 0,
    request.gateZM,
    request.kind,
    request.blockerSpeedMps,
    request.targetSpeedMps,
    request.attempt ?? 0,
    request.rowOffsetsM,
  );
}

/** Replays every advertised takeoff tick and rejects altered dependencies/traces. */
export function verifyJumpCertificate(
  request: GateCertificationRequest,
  certificate: ChallengeCertificate,
): boolean {
  if (certificate.kind !== 'jump' || !certificate.locked) return false;
  const tick = request.tick ?? 0;
  const attempt = request.attempt ?? 0;
  const traffic = request.traffic ?? [];
  const world: MutableWorldState = {
    seed: request.seed >>> 0,
    tickNumber: tick,
    player: clonePlayer(request.player),
    traffic: traffic.map(cloneTraffic),
    bonusScore: request.bonusScore ?? 0,
    rear: {
      slowTimeS: request.slowTimeS ?? 0,
      recoveryTimeS: request.recoveryTimeS ?? 0,
      rearPackActive:
        request.rearPackActive ??
        traffic.some((vehicle) => vehicle.role === 'rear-pressure'),
      rearWarning: request.rearWarning ?? false,
    },
  };
  const rowOffsetsM = normalizeGateRowOffsets(request.rowOffsetsM);
  if (rowOffsetsM === null) return false;
  const candidate: GateCandidate = {
    gateZM: request.gateZM,
    kind: request.kind,
    blockerSpeedMps: request.blockerSpeedMps,
    targetSpeedMps: request.targetSpeedMps,
    attempt,
    rowOffsetsM,
  };
  const expected = certifyGate(
    world.seed,
    tick,
    world.player,
    world.traffic,
    world.rear.slowTimeS,
    world.rear.recoveryTimeS,
    world.rear.rearPackActive,
    world.rear.rearWarning,
    world.bonusScore,
    candidate.gateZM,
    candidate.kind,
    candidate.blockerSpeedMps,
    candidate.targetSpeedMps,
    candidate.attempt,
    candidate.rowOffsetsM,
  );
  if (
    expected === null ||
    JSON.stringify(canonicalCertificate(certificate)) !==
      JSON.stringify(canonicalCertificate(expected))
  ) {
    return false;
  }

  let actualMinimumClearanceM = Number.POSITIVE_INFINITY;
  for (
    let inputTick = certificate.safeTakeoffTickMin;
    inputTick <= certificate.safeTakeoffTickMax;
    inputTick += 1
  ) {
    const replay = simulateGateWitness(
      world,
      candidate,
      certificate.targetLane,
      inputTick - tick,
      false,
    );
    if (!replay.success) return false;
    actualMinimumClearanceM = Math.min(
      actualMinimumClearanceM,
      replay.verticalClearanceM,
    );
  }
  const midpoint = Math.floor(
    (certificate.safeTakeoffTickMin + certificate.safeTakeoffTickMax) / 2,
  );
  const selectedReplay = simulateGateWitness(
    world,
    candidate,
    certificate.targetLane,
    midpoint - tick,
    true,
  );
  return (
    selectedReplay.success &&
    selectedReplay.witnessTraceHash === certificate.witnessTraceHash &&
    certificate.verticalClearanceM >= VERTICAL_CLEARANCE_M &&
    certificate.verticalClearanceM <= actualMinimumClearanceM + 1e-9 &&
    certificate.longitudinalMarginM === LONGITUDINAL_MARGIN_M
  );
}

export class AutorooSimulation {
  readonly seed: number;
  private phase: RunPhase = 'ready';
  private readonly world: MutableWorldState;
  private encounterCursorM = 130;
  private encounterIndex = 0;
  private lastEscapeLane: LaneIndex = 1;
  private gateIndex = 0;
  private pendingGateZM: number;
  private lastGateZM = 0;
  private pendingGateAttempted = false;
  private activeCertificate: ChallengeCertificate | null = null;
  private readonly groundRoutes: GroundRoute[] = [];
  private readonly events: GameEvent[] = [];
  private lastBonusLabel: string | null = null;

  constructor(seed = 0xa770_2026) {
    this.seed = seed >>> 0;
    this.world = {
      seed: this.seed,
      tickNumber: 0,
      player: makePlayer(),
      traffic: [],
      bonusScore: 0,
      rear: {
        slowTimeS: 0,
        recoveryTimeS: 0,
        rearPackActive: false,
        rearWarning: false,
      },
    };
    this.pendingGateZM =
      nudgeGateToSteadyRoad(this.seed, firstGateDistance(this.seed)) ??
      Number.POSITIVE_INFINITY;
    this.fillAhead();
  }

  private get tickNumber(): number {
    return this.world.tickNumber;
  }

  private set tickNumber(value: number) {
    this.world.tickNumber = value;
  }

  private get player(): PlayerState {
    return this.world.player;
  }

  private set player(value: PlayerState) {
    this.world.player = value;
  }

  private get traffic(): TrafficVehicle[] {
    return this.world.traffic;
  }

  private get bonusScore(): number {
    return this.world.bonusScore;
  }

  private set bonusScore(value: number) {
    this.world.bonusScore = value;
  }

  private get slowTimeS(): number {
    return this.world.rear.slowTimeS;
  }

  private set slowTimeS(value: number) {
    this.world.rear.slowTimeS = value;
  }

  private get recoveryTimeS(): number {
    return this.world.rear.recoveryTimeS;
  }

  private set recoveryTimeS(value: number) {
    this.world.rear.recoveryTimeS = value;
  }

  private get rearPackActive(): boolean {
    return this.world.rear.rearPackActive;
  }

  private set rearPackActive(value: boolean) {
    this.world.rear.rearPackActive = value;
  }

  private get rearWarning(): boolean {
    return this.world.rear.rearWarning;
  }

  private set rearWarning(value: boolean) {
    this.world.rear.rearWarning = value;
  }

  get phaseName(): RunPhase {
    return this.phase;
  }

  start(): void {
    if (this.phase === 'game-over') this.resetRun();
    this.phase = 'running';
  }

  restart(): void {
    this.resetRun();
    this.phase = 'running';
  }

  setPaused(paused: boolean): void {
    if (this.phase === 'game-over' || this.phase === 'ready') return;
    this.phase = paused ? 'paused' : 'running';
  }

  private resetRun(): void {
    this.phase = 'ready';
    this.tickNumber = 0;
    this.player = makePlayer();
    this.traffic.length = 0;
    this.bonusScore = 0;
    this.encounterCursorM = 130;
    this.encounterIndex = 0;
    this.lastEscapeLane = 1;
    this.gateIndex = 0;
    this.lastGateZM = 0;
    this.pendingGateZM =
      nudgeGateToSteadyRoad(this.seed, firstGateDistance(this.seed)) ??
      Number.POSITIVE_INFINITY;
    this.pendingGateAttempted = false;
    this.activeCertificate = null;
    this.groundRoutes.length = 0;
    this.slowTimeS = 0;
    this.recoveryTimeS = 0;
    this.rearPackActive = false;
    this.rearWarning = false;
    this.events.length = 0;
    this.lastBonusLabel = null;
    this.fillAhead();
  }

  tick(input: InputFrame): void {
    if (this.phase !== 'running') return;
    this.lastBonusLabel = null;
    const previousLane = this.player.lane;
    const outcome = stepWorld(this.world, input);
    if ((outcome & WORLD_JUMPED) !== 0) this.emitEvent({ type: 'jump' });
    if ((outcome & WORLD_CRASHED) !== 0) {
      this.phase = 'game-over';
      this.emitEvent({ type: 'crash' });
      return;
    }
    if (this.player.lane !== previousLane)
      this.emitEvent({ type: 'lane-change' });

    this.resolveScoring();
    // The final swept segment has been collision-checked and any pass bonus
    // finalized before this immutable taper-boundary retirement.
    retireCompletedOrdinaryTrajectories(this.world);
    if ((outcome & WORLD_REAR_SPAWNED) !== 0) {
      this.emitEvent({ type: 'warning' });
      this.emitEvent({ type: 'horn' });
    }
    this.cullBehind();
    this.advanceGateLifecycle();
    this.fillAhead();
    this.tryRevealGate();
  }

  private resolveScoring(): void {
    const centeredForWholeTick =
      isPlayerCenteredInLane(this.player) &&
      Math.abs(this.player.previousXM - this.player.xM) < 1e-9;
    for (const vehicle of this.traffic) {
      const halfExtent =
        PLAYER_LENGTH_M / 2 + vehicle.lengthM / 2 + LONGITUDINAL_MARGIN_M;
      const longitudinalOverlap = sweptOverlapInterval(
        this.player.previousZM,
        this.player.absoluteZM,
        vehicle.previousZM,
        vehicle.absoluteZM,
        halfExtent,
      );
      const footprintOverlap = sweptVehicleOverlapInterval(
        this.player,
        vehicle,
      );
      if (footprintOverlap) {
        if (this.player.airborne || this.player.previousYM > 0)
          vehicle.airborneOverlap = true;
      }
      if (
        longitudinalOverlap &&
        !this.player.airborne &&
        this.player.previousYM === 0 &&
        centeredForWholeTick &&
        Math.abs(this.player.lane - vehicle.lane) === 1
      ) {
        vehicle.closePassOverlap = true;
      }
    }

    // Resolve simultaneous bonuses in canonical ID order. Traffic storage is
    // deliberately not part of the simulation contract, so it cannot affect
    // event ordering or the last visible bonus label.
    let previousAwardedId: string | null = null;
    while (true) {
      let next: TrafficVehicle | null = null;
      for (const vehicle of this.traffic) {
        const fullyPassed =
          this.player.absoluteZM - vehicle.absoluteZM >
          PLAYER_LENGTH_M / 2 + vehicle.lengthM / 2 + LONGITUDINAL_MARGIN_M;
        const hasBonus = vehicle.airborneOverlap || vehicle.closePassOverlap;
        if (
          !fullyPassed ||
          !hasBonus ||
          vehicle.bonusAwarded ||
          vehicle.role === 'rear-pressure' ||
          (previousAwardedId !== null && vehicle.id <= previousAwardedId)
        ) {
          continue;
        }
        if (next === null || vehicle.id < next.id) next = vehicle;
      }
      if (next === null) break;
      if (next.airborneOverlap) {
        const points = next.kind === 'bus' ? 250 : 100;
        const label = next.kind === 'bus' ? 'BUS BOUNCE!' : 'CAR HOP!';
        this.awardBonus(next, points, label);
      } else {
        this.awardBonus(next, 25, 'TOO CLOSE!');
      }
      previousAwardedId = next.id;
    }
  }

  private awardBonus(
    vehicle: TrafficVehicle,
    points: number,
    label: string,
  ): void {
    vehicle.bonusAwarded = true;
    this.bonusScore += points;
    this.lastBonusLabel = `${label} +${points}`;
    this.emitEvent({ type: 'bonus', label, points });
  }

  private emitEvent(event: GameEvent): void {
    if (this.events.length >= MAX_PENDING_EVENTS) this.events.shift();
    this.events.push(event);
  }

  private cullBehind(): void {
    for (let index = this.traffic.length - 1; index >= 0; index -= 1) {
      const vehicle = this.traffic[index];
      const passedExtentM =
        PLAYER_LENGTH_M / 2 + vehicle.lengthM / 2 + LONGITUDINAL_MARGIN_M;
      if (
        vehicle.role !== 'rear-pressure' &&
        !vehicle.locked &&
        !this.activeCertificate &&
        vehicle.absoluteZM < this.player.absoluteZM - passedExtentM
      ) {
        this.traffic.splice(index, 1);
      }
    }
    while (
      this.groundRoutes.length > 0 &&
      this.groundRoutes[0].zM < this.player.absoluteZM - 100
    ) {
      this.groundRoutes.shift();
    }
  }

  private advanceGateLifecycle(): void {
    if (!this.pendingGateAttempted) return;
    if (this.activeCertificate) {
      let blockerCount = 0;
      let passedAll = true;
      let landingReservationEndM = Number.NEGATIVE_INFINITY;
      for (const vehicle of this.traffic) {
        if (vehicle.certificateId !== this.activeCertificate.id) continue;
        blockerCount += 1;
        const passBoundaryM =
          vehicle.absoluteZM +
          PLAYER_LENGTH_M / 2 +
          vehicle.lengthM / 2 +
          LONGITUDINAL_MARGIN_M;
        landingReservationEndM = Math.max(
          landingReservationEndM,
          passBoundaryM + GATE_LANDING_CLEAR_M,
        );
        if (this.player.absoluteZM <= passBoundaryM) {
          passedAll = false;
        }
      }
      passedAll &&= blockerCount > 0;
      const landedBeyondReservation =
        !this.player.airborne &&
        this.player.absoluteZM >= landingReservationEndM;
      if (!passedAll || !landedBeyondReservation) return;
    } else if (
      this.player.absoluteZM <=
      this.pendingGateZM + GATE_LANDING_CLEAR_M
    ) {
      return;
    }
    for (const vehicle of this.traffic) {
      if (vehicle.certificateId === this.activeCertificate?.id)
        vehicle.locked = false;
    }
    this.activeCertificate = null;
    this.lastGateZM = this.pendingGateZM;
    this.encounterCursorM = Math.max(
      this.encounterCursorM,
      this.player.absoluteZM + 80,
    );
    this.scheduleNextGate();
  }

  private scheduleNextGate(): void {
    const previousPlacedM = Number.isFinite(this.lastGateZM)
      ? this.lastGateZM
      : this.player.absoluteZM;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      this.gateIndex += 1;
      const requestedM = nextGateDistance(
        this.seed,
        this.gateIndex,
        previousPlacedM,
      );
      const minimumM = previousPlacedM + 500;
      const placedM = nudgeGateToSteadyRoad(this.seed, requestedM, minimumM);
      if (placedM === null || placedM < previousPlacedM + 500) continue;
      this.pendingGateZM = placedM;
      this.pendingGateAttempted = false;
      return;
    }
    // A bounded placement failure degrades to clear road without blocking play.
    this.pendingGateZM = Number.POSITIVE_INFINITY;
    this.pendingGateAttempted = true;
  }

  private fillAhead(): void {
    if (this.activeCertificate) return;
    while (this.encounterCursorM < this.player.absoluteZM + FRONT_DRAW_M) {
      if (
        this.encounterCursorM >= this.pendingGateZM - GATE_APPROACH_CLEAR_M &&
        this.encounterCursorM < this.pendingGateZM + GATE_FORWARD_STEADY_M
      ) {
        this.encounterCursorM = this.pendingGateZM + GATE_FORWARD_STEADY_M;
        continue;
      }
      const roadModule = roadModuleForDistance(
        this.seed,
        this.encounterCursorM,
      );
      if (!roadModule.trafficAllowed) {
        this.encounterCursorM = roadModule.endM + 10;
        continue;
      }
      if (
        !isSteadyRoadRange(
          this.seed,
          this.encounterCursorM,
          this.encounterCursorM + ORDINARY_FORWARD_STEADY_M,
        )
      ) {
        const taperStartM = nextTaperStartM(this.seed, this.encounterCursorM);
        if (Number.isFinite(taperStartM)) {
          this.encounterCursorM =
            roadModuleForDistance(this.seed, taperStartM).endM + 10;
          continue;
        }
      }
      this.spawnOrdinaryEncounter(this.encounterCursorM);
      const difficulty = difficultyAt(this.encounterCursorM);
      this.encounterCursorM += ordinaryGapM(
        this.seed,
        this.encounterIndex,
        difficulty,
      );
      this.encounterIndex += 1;
    }
  }

  private spawnOrdinaryEncounter(zM: number): void {
    // A row is only revealed if its complete 20-second certified trajectory
    // remains on steady road. A future taper is deferred by emitting clear road,
    // never by deleting a vehicle the player has already seen.
    if (!isSteadyRoadRange(this.seed, zM, zM + ORDINARY_FORWARD_STEADY_M)) {
      return;
    }
    const mask = laneMaskAt(this.seed, zM);
    const lanes = activeLanes(mask);
    const difficulty = difficultyAt(zM);
    const preferredEscapeLane = chooseEscapeLane(
      this.seed,
      this.encounterIndex,
      mask,
      this.lastEscapeLane,
      difficulty,
    );
    const encounterId = `ordinary-${this.encounterIndex}`;
    const certificateId = `ground-${this.encounterIndex}`;
    const taperStartM = nextTaperStartM(this.seed, zM);
    const escapeOptions = lanes
      .filter((lane) => Math.abs(lane - this.lastEscapeLane) <= 1)
      .sort((first, second) => {
        if (first === preferredEscapeLane) return -1;
        if (second === preferredEscapeLane) return 1;
        return (
          hashParts(this.seed, this.encounterIndex, first, 367) -
          hashParts(this.seed, this.encounterIndex, second, 367)
        );
      });

    for (const escapeLane of escapeOptions) {
      const candidates = lanes
        .filter((lane) => lane !== escapeLane)
        .sort(
          (first, second) =>
            hashParts(this.seed, this.encounterIndex, first, 311) -
            hashParts(this.seed, this.encounterIndex, second, 311),
        );
      const blockingPressure = Math.min(1, difficulty * 1.45);
      const blockedCount = Math.min(
        candidates.length,
        1 +
          Math.floor(blockingPressure * Math.max(0, candidates.length - 0.01)),
      );
      let currentCars = this.traffic.filter(
        (vehicle) => vehicle.role !== 'rear-pressure' && vehicle.kind !== 'bus',
      ).length;
      let currentBuses = this.traffic.filter(
        (vehicle) => vehicle.role !== 'rear-pressure' && vehicle.kind === 'bus',
      ).length;
      const drafted: TrafficVehicle[] = [];
      for (let index = 0; index < blockedCount; index += 1) {
        const busChance = 0.12 + difficulty * 0.3;
        const preferredKind: VehicleKind =
          hashUnit(this.seed, this.encounterIndex, index, 347) < busChance
            ? 'bus'
            : hashParts(this.seed, this.encounterIndex, index, 349) % 2 === 0
              ? 'sedan'
              : 'suv';
        let kind = preferredKind;
        if (kind === 'bus' && currentBuses >= RENDER_POOL_LIMITS.buses) {
          kind =
            hashParts(this.seed, this.encounterIndex, index, 353) % 2 === 0
              ? 'sedan'
              : 'suv';
        } else if (
          kind !== 'bus' &&
          currentCars >= RENDER_POOL_LIMITS.frontCars
        ) {
          kind = 'bus';
        }
        if (
          (kind === 'bus' && currentBuses >= RENDER_POOL_LIMITS.buses) ||
          (kind !== 'bus' && currentCars >= RENDER_POOL_LIMITS.frontCars)
        )
          continue;
        if (kind === 'bus') currentBuses += 1;
        else currentCars += 1;
        drafted.push(
          createTrafficVehicle(
            `${encounterId}-${candidates[index]}`,
            encounterId,
            kind,
            'ordinary',
            candidates[index],
            zM,
            8,
            certificateId,
            Number.isFinite(taperStartM)
              ? taperStartM -
                  vehicleDimensions(kind).lengthM / 2 -
                  LONGITUDINAL_MARGIN_M
              : null,
          ),
        );
      }
      if (drafted.length === 0) continue;

      const routeTargets = new Map<string, LaneIndex>();
      for (const route of this.groundRoutes) {
        routeTargets.set(route.encounterId, route.certificate.targetLane);
      }
      routeTargets.set(encounterId, escapeLane);
      const replay = simulateGroundWitness(this.world, drafted, routeTargets);
      if (!replay.success) continue;

      const blockerTrajectories = drafted.map((vehicle) => ({
        id: vehicle.id,
        lane: vehicle.lane,
        startTick: this.tickNumber,
        startZM: vehicle.absoluteZM,
        speedMps: vehicle.speedMps,
        retireAtZM: vehicle.retireAtZM,
      }));
      const lockedStateHash = hashLockedWorld(this.world);
      const dependencyHash = stableHash(
        JSON.stringify([
          lockedStateHash,
          lateralRulesFingerprint(),
          this.encounterIndex,
          exactNumber(zM),
          mask,
          escapeLane,
          blockerTrajectories.map((trajectory) => [
            trajectory.id,
            trajectory.lane,
            exactNumber(trajectory.startZM),
            exactNumber(trajectory.speedMps),
            trajectory.retireAtZM === null
              ? null
              : exactNumber(trajectory.retireAtZM),
          ]),
        ]),
      );
      const certificate = freezeCertificate({
        version: 1,
        id: certificateId,
        kind: 'ground',
        gateSeed: hashParts(this.seed, this.encounterIndex, 359),
        locked: true,
        revealTick: this.tickNumber,
        lockedStateHash,
        dependencyHash,
        targetLane: escapeLane,
        selectedVehicle: drafted[0].kind,
        blockerIds: drafted.map((vehicle) => vehicle.id),
        blockerTrajectories,
        safeTakeoffTickMin: 0,
        safeTakeoffTickMax: 0,
        minimumSpeedMps: 0,
        targetSpeedMps: 0,
        verticalClearanceM: 0,
        longitudinalMarginM: LONGITUDINAL_MARGIN_M,
        timingMarginTicks: 0,
        inputWindowS: 0,
        witnessTraceHash: replay.witnessTraceHash,
        witness: replay.witness,
      });
      this.traffic.push(...drafted);
      this.groundRoutes.push({ zM, encounterId, certificate });
      this.lastEscapeLane = escapeLane;
      return;
    }
    // A failed draft becomes clear road; generation always advances its cursor.
  }

  private tryRevealGate(): void {
    if (
      this.pendingGateAttempted ||
      this.pendingGateZM - this.player.absoluteZM > GATE_REVEAL_M ||
      this.pendingGateZM <= this.player.absoluteZM
    ) {
      return;
    }
    this.pendingGateAttempted = true;
    const gateDifficulty = difficultyAt(this.player.maxForwardM);
    const preferSuv =
      gateDifficulty > 0.45 &&
      hashParts(this.seed, this.gateIndex, 401) % 3 === 0;
    const requestedRows =
      this.gateIndex === 0
        ? 2
        : gateDifficulty < 0.99 ||
            (gateDifficulty < 0.999 &&
              hashParts(this.seed, this.gateIndex, 409) % 4 === 0)
          ? 3
          : 4;
    const gateLaneCount = activeLanes(
      laneMaskAt(this.seed, this.pendingGateZM),
    ).length;
    const currentFrontCars = this.traffic.filter(
      (vehicle) => vehicle.role !== 'rear-pressure' && vehicle.kind !== 'bus',
    ).length;
    const availableRows = Math.floor(
      (RENDER_POOL_LIMITS.frontCars - currentFrontCars) / gateLaneCount,
    );
    if (availableRows < 1) {
      this.replacePendingGateWithOrdinary();
      return;
    }
    const desiredRows = Math.min(requestedRows, availableRows);
    // The compact jump still clears ordinary buses at full speed, but their
    // long collider cannot offer the mandatory 0.25 s input window. Certified
    // all-lane gauntlets therefore use shorter cars and SUVs only. The final
    // attempt deliberately degrades to one row instead of stalling generation.
    const attempts: readonly [VehicleKind, number, number, number, number][] =
      preferSuv
        ? [
            ['suv', 3, 28, desiredRows, 1],
            ['sedan', 4, 28, desiredRows, 1],
            ['suv', 2.5, 28, Math.max(1, desiredRows - 1), 1.015],
            ['sedan', 3.5, 27, 1, 1],
          ]
        : [
            ['sedan', 4, 28, desiredRows, 1],
            ['suv', 3, 28, desiredRows, 1],
            ['sedan', 3.5, 27, Math.max(1, desiredRows - 1), 1.015],
            ['suv', 2.5, 28, 1, 1],
          ];
    let certificate: ChallengeCertificate | null = null;
    for (let attempt = 0; attempt < attempts.length; attempt += 1) {
      const [kind, blockerSpeed, targetSpeed, rowCount, spacingScale] =
        attempts[attempt];
      certificate = certifyGate(
        this.seed,
        this.tickNumber,
        this.player,
        this.traffic,
        this.slowTimeS,
        this.recoveryTimeS,
        this.rearPackActive,
        this.rearWarning,
        this.bonusScore,
        this.pendingGateZM,
        kind,
        blockerSpeed,
        targetSpeed,
        attempt,
        jumpChainOffsetsM(rowCount, blockerSpeed, spacingScale),
      );
      if (certificate) break;
    }
    if (!certificate) {
      this.replacePendingGateWithOrdinary();
      return;
    }

    this.activeCertificate = certificate;
    for (const trajectory of certificate.blockerTrajectories) {
      this.traffic.push(
        createTrafficVehicle(
          trajectory.id,
          certificate.id,
          certificate.selectedVehicle,
          'gate',
          trajectory.lane,
          trajectory.startZM,
          trajectory.speedMps,
          certificate.id,
        ),
      );
    }
    this.emitEvent({ type: 'warning' });
  }

  private replacePendingGateWithOrdinary(): void {
    // A rejected jump draft becomes a certified ordinary row, then normal
    // dense generation resumes immediately beyond it. This preserves the
    // fail-open invariant without leaving the whole reserved landing corridor
    // visibly empty.
    const fallbackGateZM = this.pendingGateZM;
    const fallbackEncounterIndex = this.encounterIndex;
    this.spawnOrdinaryEncounter(fallbackGateZM);
    this.encounterIndex += 1;
    this.lastGateZM = fallbackGateZM;
    this.scheduleNextGate();
    this.encounterCursorM = Math.min(
      this.encounterCursorM,
      fallbackGateZM +
        ordinaryGapM(
          this.seed,
          fallbackEncounterIndex,
          difficultyAt(fallbackGateZM),
        ),
    );
    this.fillAhead();
  }

  snapshot(): RunSnapshot {
    const mask = laneMaskAt(this.seed, this.player.absoluteZM);
    return {
      version: 1,
      seed: this.seed,
      tick: this.tickNumber,
      phase: this.phase,
      elapsedS: this.tickNumber * FIXED_DT,
      player: { ...this.player },
      traffic: this.traffic.map((vehicle) => ({ ...vehicle })),
      score: Math.floor(this.player.maxForwardM) + this.bonusScore,
      bonusScore: this.bonusScore,
      difficulty: difficultyAt(this.player.maxForwardM),
      laneMask: mask,
      laneCount: countLanes(mask),
      rearWarning: this.rearWarning,
      activeCertificate: this.activeCertificate,
      lastBonusLabel: this.lastBonusLabel,
    };
  }

  get renderPlayer(): Readonly<PlayerState> {
    return this.player;
  }

  get renderTraffic(): readonly Readonly<TrafficVehicle>[] {
    return this.traffic;
  }

  get renderTick(): number {
    return this.tickNumber;
  }

  get renderCertificate(): ChallengeCertificate | null {
    return this.activeCertificate;
  }

  drainEvents(): GameEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }

  getGroundCertificates(): readonly ChallengeCertificate[] {
    return this.groundRoutes.map((route) => route.certificate);
  }

  /** Deterministic harness hook used only by the unit tests. */
  __debugSetPlayer(patch: Partial<PlayerState>): void {
    const laneWasPatched = patch.lane !== undefined;
    const xWasPatched = patch.xM !== undefined;
    Object.assign(this.player, patch);
    if (laneWasPatched && !xWasPatched) {
      const laneXM = LANE_X[this.player.lane];
      this.player.xM = laneXM;
      this.player.previousXM = laneXM;
      this.player.laneChangeStartXM = laneXM;
      this.player.laneChangeElapsedS = 0;
      this.player.laneChangeDirection = 0;
      this.player.queuedLane = null;
    } else if (xWasPatched && patch.previousXM === undefined) {
      this.player.previousXM = this.player.xM;
    }
  }

  /** Deterministic harness hook used only by the unit tests. */
  __debugReplaceTraffic(vehicles: readonly TrafficVehicle[]): void {
    this.traffic.length = 0;
    for (const vehicle of vehicles) this.traffic.push(cloneTraffic(vehicle));
    this.rearPackActive = vehicles.some(
      (vehicle) => vehicle.role === 'rear-pressure',
    );
  }

  /** Deterministic harness hook used only by the unit/stress tests. */
  __debugSetRearState(patch: Partial<MutableRearState>): void {
    Object.assign(this.world.rear, patch);
  }

  /** Deterministic harness hook used only by the unit tests. */
  __debugSetGateState(
    patch: Partial<{
      gateIndex: number;
      pendingGateZM: number;
      pendingGateAttempted: boolean;
      lastGateZM: number;
      activeCertificate: ChallengeCertificate | null;
    }>,
  ): void {
    if (patch.gateIndex !== undefined) this.gateIndex = patch.gateIndex;
    if (patch.pendingGateZM !== undefined)
      this.pendingGateZM = patch.pendingGateZM;
    if (patch.pendingGateAttempted !== undefined) {
      this.pendingGateAttempted = patch.pendingGateAttempted;
    }
    if (patch.lastGateZM !== undefined) this.lastGateZM = patch.lastGateZM;
    if (patch.activeCertificate !== undefined)
      this.activeCertificate = patch.activeCertificate;
  }

  debugGateState(): Readonly<{
    gateIndex: number;
    pendingGateZM: number;
    pendingGateAttempted: boolean;
    lastGateZM: number;
    activeCertificate: ChallengeCertificate | null;
  }> {
    return {
      gateIndex: this.gateIndex,
      pendingGateZM: this.pendingGateZM,
      pendingGateAttempted: this.pendingGateAttempted,
      lastGateZM: this.lastGateZM,
      activeCertificate: this.activeCertificate,
    };
  }

  debugRetainedCounts(): Readonly<{
    frontCars: number;
    buses: number;
    rearCars: number;
    totalTraffic: number;
    groundCertificates: number;
    activeCertificates: number;
    witnessPoints: number;
    pendingEvents: number;
  }> {
    const rearCars = this.traffic.filter(
      (vehicle) => vehicle.role === 'rear-pressure',
    ).length;
    const buses = this.traffic.filter(
      (vehicle) => vehicle.role !== 'rear-pressure' && vehicle.kind === 'bus',
    ).length;
    const frontCars = this.traffic.filter(
      (vehicle) => vehicle.role !== 'rear-pressure' && vehicle.kind !== 'bus',
    ).length;
    let witnessPoints = this.activeCertificate?.witness.length ?? 0;
    for (const route of this.groundRoutes)
      witnessPoints += route.certificate.witness.length;
    return {
      frontCars,
      buses,
      rearCars,
      totalTraffic: this.traffic.length,
      groundCertificates: this.groundRoutes.length,
      activeCertificates: this.activeCertificate ? 1 : 0,
      witnessPoints,
      pendingEvents: this.events.length,
    };
  }

  stateHash(): string {
    return stableHash(
      JSON.stringify([
        hashLockedWorld(this.world),
        this.phase,
        exactNumber(this.encounterCursorM),
        this.encounterIndex,
        this.lastEscapeLane,
        this.gateIndex,
        exactNumber(this.pendingGateZM),
        exactNumber(this.lastGateZM),
        this.pendingGateAttempted,
        this.activeCertificate
          ? canonicalCertificate(this.activeCertificate)
          : null,
        this.groundRoutes.map((route) => [
          route.encounterId,
          exactNumber(route.zM),
          canonicalCertificate(route.certificate),
        ]),
        this.lastBonusLabel,
        this.events.map(canonicalEvent),
      ]),
    );
  }
}

export function runRenderSchedule(
  simulation: AutorooSimulation,
  frameDurationsS: readonly number[],
  inputAtTick: (tick: number) => InputFrame,
): string {
  let accumulator = 0;
  let inputTick = 0;
  for (const frameDuration of frameDurationsS) {
    accumulator = Math.min(0.25, accumulator + frameDuration);
    while (accumulator + 1e-12 >= FIXED_DT) {
      simulation.tick(inputAtTick(inputTick));
      inputTick += 1;
      accumulator -= FIXED_DT;
    }
  }
  return simulation.stateHash();
}
