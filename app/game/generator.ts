import {
  FOUR_LANES,
  GATE_APPROACH_CLEAR_M,
  GATE_FORWARD_STEADY_M,
  MODULE_LENGTH_M,
  THREE_LEFT,
  THREE_RIGHT,
  TWO_LANES,
  activeLanes,
  hasLane,
} from './constants';
import type { LaneIndex, LaneMask, RoadModule } from './contracts';
import { hashChoice, hashParts, hashUnit } from './random';

const TRANSITION_TEMPLATES = [
  // Each epoch starts and ends on the three-lane default, briefly contracts to
  // two lanes, then expands through three lanes to a broad six-module
  // four-lane plateau. Of the 16 traffic-capable modules, eight are three-lane,
  // six are four-lane, and only two are two-lane.
  [2, 5, 8, 15],
  [3, 6, 9, 16],
  [2, 5, 9, 16],
  [3, 6, 10, 17],
] as const;

function boundaryThreeMask(seed: number, boundary: number): LaneMask {
  return hashParts(seed, boundary, 59) % 2 === 0 ? THREE_LEFT : THREE_RIGHT;
}

function epochPlan(seed: number, epoch: number) {
  const transitions = hashChoice(TRANSITION_TEMPLATES, seed, epoch, 41);
  const entryThreeMask = boundaryThreeMask(seed, epoch);
  const middleThreeMask =
    hashParts(seed, epoch, 61) % 2 === 0 ? THREE_LEFT : THREE_RIGHT;
  const exitThreeMask = boundaryThreeMask(seed, epoch + 1);
  return { transitions, entryThreeMask, middleThreeMask, exitThreeMask };
}

function masksAtLocal(
  localIndex: number,
  transitions: readonly number[],
  entryThreeMask: LaneMask,
  middleThreeMask: LaneMask,
  exitThreeMask: LaneMask,
): { from: LaneMask; to: LaneMask } {
  const [downToTwo, upToThree, upToFour, downToThree] = transitions;
  if (localIndex < downToTwo)
    return { from: entryThreeMask, to: entryThreeMask };
  if (localIndex === downToTwo) return { from: entryThreeMask, to: TWO_LANES };
  if (localIndex < upToThree) return { from: TWO_LANES, to: TWO_LANES };
  if (localIndex === upToThree) return { from: TWO_LANES, to: middleThreeMask };
  if (localIndex < upToFour)
    return { from: middleThreeMask, to: middleThreeMask };
  if (localIndex === upToFour) return { from: middleThreeMask, to: FOUR_LANES };
  if (localIndex < downToThree) return { from: FOUR_LANES, to: FOUR_LANES };
  if (localIndex === downToThree)
    return { from: FOUR_LANES, to: exitThreeMask };
  return { from: exitThreeMask, to: exitThreeMask };
}

function changedLane(from: LaneMask, to: LaneMask): LaneIndex {
  const bit = from ^ to;
  for (let lane = 0; lane < 4; lane += 1) {
    if ((bit & (1 << lane)) !== 0) return lane as LaneIndex;
  }
  return 1;
}

export function roadModuleAt(seed: number, moduleIndex: number): RoadModule {
  const safeIndex = Math.max(0, Math.floor(moduleIndex));
  const epoch = Math.floor(safeIndex / 20);
  const localIndex = safeIndex % 20;
  const { transitions, entryThreeMask, middleThreeMask, exitThreeMask } =
    epochPlan(seed, epoch);
  const { from, to } = masksAtLocal(
    localIndex,
    transitions,
    entryThreeMask,
    middleThreeMask,
    exitThreeMask,
  );
  const startM = safeIndex * MODULE_LENGTH_M;
  const transition =
    from === to
      ? null
      : {
          kind: (from & to) === from ? ('add' as const) : ('remove' as const),
          lane: changedLane(from, to),
          warningEndM: startM + 50,
          taperEndM: startM + 100,
        };
  return {
    index: safeIndex,
    startM,
    endM: startM + MODULE_LENGTH_M,
    fromLaneMask: from,
    toLaneMask: to,
    transition,
    trafficAllowed: transition === null,
  };
}

export function roadModuleForDistance(
  seed: number,
  distanceM: number,
): RoadModule {
  return roadModuleAt(
    seed,
    Math.floor(Math.max(0, distanceM) / MODULE_LENGTH_M),
  );
}

/**
 * Lane anchors never move. Added lanes open after their taper; removed lanes
 * close when their taper begins, after the full 50 m warning zone.
 */
export function laneMaskAt(seed: number, distanceM: number): LaneMask {
  const roadModule = roadModuleForDistance(seed, distanceM);
  if (
    roadModule.transition?.kind === 'remove' &&
    distanceM >= roadModule.transition.warningEndM
  ) {
    return roadModule.toLaneMask;
  }
  return roadModule.fromLaneMask;
}

export function visualRoadProfileAt(
  seed: number,
  distanceM: number,
): {
  centerX: number;
  widthM: number;
  laneMask: LaneMask;
  transitionAmount: number;
} {
  const roadModule = roadModuleForDistance(seed, distanceM);
  const mask = laneMaskAt(seed, distanceM);
  let transitionAmount = 0;
  if (roadModule.transition && distanceM >= roadModule.transition.warningEndM) {
    const linearAmount = Math.min(
      1,
      Math.max(0, (distanceM - roadModule.transition.warningEndM) / 50),
    );
    // A cubic smoothstep keeps both ends of the 50 m taper tangent to the
    // straight road, so expansions and contractions read as a continuous
    // curve instead of a diagonal wedge with visible kinks.
    transitionAmount = linearAmount * linearAmount * (3 - 2 * linearAmount);
  }
  const fromLanes = activeLanes(roadModule.fromLaneMask);
  const toLanes = activeLanes(roadModule.toLaneMask);
  const fromCenter = (fromLanes[0] + fromLanes[fromLanes.length - 1] - 3) * 1.8;
  const toCenter = (toLanes[0] + toLanes[toLanes.length - 1] - 3) * 1.8;
  return {
    centerX: fromCenter + (toCenter - fromCenter) * transitionAmount,
    widthM:
      fromLanes.length * 3.6 +
      (toLanes.length - fromLanes.length) * 3.6 * transitionAmount,
    laneMask: mask,
    transitionAmount,
  };
}

/** Conservative rectangular render tile that never narrows before gameplay. */
export function visualRoadTileProfile(
  seed: number,
  startM: number,
  endM: number,
): { centerX: number; widthM: number; laneMask: LaneMask } {
  const epsilonM = 0.001;
  const sampleM = [
    Math.max(0, startM + epsilonM),
    Math.max(0, (startM + endM) / 2),
    Math.max(0, endM - epsilonM),
  ];
  let leftEdgeM = Number.POSITIVE_INFINITY;
  let rightEdgeM = Number.NEGATIVE_INFINITY;
  let laneMask = 0;
  for (const distanceM of sampleM) {
    const profile = visualRoadProfileAt(seed, distanceM);
    leftEdgeM = Math.min(leftEdgeM, profile.centerX - profile.widthM / 2);
    rightEdgeM = Math.max(rightEdgeM, profile.centerX + profile.widthM / 2);
    laneMask |= profile.laneMask;
  }
  return {
    centerX: (leftEdgeM + rightEdgeM) / 2,
    widthM: rightEdgeM - leftEdgeM,
    laneMask,
  };
}

export function nextActiveLane(
  mask: LaneMask,
  lane: LaneIndex,
  delta: -1 | 1,
): LaneIndex {
  let candidate = lane + delta;
  while (candidate >= 0 && candidate <= 3) {
    if (hasLane(mask, candidate as LaneIndex)) return candidate as LaneIndex;
    candidate += delta;
  }
  return lane;
}

export function nearestActiveLane(mask: LaneMask, lane: LaneIndex): LaneIndex {
  const lanes = activeLanes(mask);
  let best = lanes[0];
  let bestDistance = Math.abs(best - lane);
  for (let index = 1; index < lanes.length; index += 1) {
    const distance = Math.abs(lanes[index] - lane);
    if (distance < bestDistance) {
      best = lanes[index];
      bestDistance = distance;
    }
  }
  return best;
}

export function chooseEscapeLane(
  seed: number,
  encounterIndex: number,
  mask: LaneMask,
  previous: LaneIndex,
  difficulty = 0,
): LaneIndex {
  const boundedDifficulty = Math.max(0, Math.min(1, difficulty));
  const candidates = activeLanes(mask).filter(
    (lane) => Math.abs(lane - previous) <= 1,
  );
  const legal = candidates.length > 0 ? candidates : activeLanes(mask);
  const alternatives = legal.filter((lane) => lane !== previous);
  const previousIsLegal = legal.includes(previous);
  const changeChance = 0.48 + 0.5 * boundedDifficulty;
  if (
    previousIsLegal &&
    (alternatives.length === 0 ||
      hashUnit(seed, encounterIndex, 71) >= changeChance)
  ) {
    return previous;
  }
  const choices = alternatives.length > 0 ? alternatives : legal;
  return choices[hashParts(seed, encounterIndex, 73) % choices.length];
}

export function ordinaryGapM(
  seed: number,
  encounterIndex: number,
  difficulty: number,
): number {
  const boundedDifficulty = Math.max(0, Math.min(1, difficulty));
  const jitter = (hashUnit(seed, encounterIndex, 97) - 0.5) * 2;
  // Late rows arrive 0.47–0.53 seconds apart at full closing speed. A jump
  // spans more than one row, and the blocked corridor changes before landing.
  // The production witness rejects drafts without a viable lateral route.
  return 34 - 18 * boundedDifficulty + jitter;
}

/** Slower late traffic increases closing speed without speeding up controls. */
export function ordinarySpeedMps(difficulty: number): number {
  return 8 - 4 * Math.max(0, Math.min(1, difficulty));
}

export function firstGateDistance(seed: number): number {
  return 420 + hashUnit(seed, 0, 211) * 40;
}

/**
 * Advances the one live gate cursor in constant time. Gaps smoothly contract
 * from roughly 600 m toward a 490–530 m cadence before road nudging. Compact
 * reservations let challenges use the shorter two- and three-lane sections.
 */
export function nextGateDistance(
  seed: number,
  gateIndex: number,
  previousPlacedM: number,
): number {
  const difficulty = 1 - Math.exp(-Math.max(0, previousPlacedM) / 900);
  const gapM =
    490 + 100 * (1 - difficulty) + hashUnit(seed, gateIndex, 223) * 40;
  return previousPlacedM + gapM;
}

/**
 * Stateless O(1) preview used by tooling and tests. Runtime scheduling uses
 * `nextGateDistance`, because it can retain the previous, road-nudged cursor.
 */
export function scheduledGateDistance(seed: number, gateIndex: number): number {
  if (gateIndex <= 0) return firstGateDistance(seed);
  const index = Math.floor(gateIndex);
  const asymptoticProgress = 90 * (1 - Math.exp(-index / 4));
  return (
    firstGateDistance(seed) +
    index * 490 +
    asymptoticProgress +
    hashUnit(seed, index, 223) * 12
  );
}

/** First boundary where a particular lane becomes inaccessible. */
export function nextLaneClosureM(
  seed: number,
  distanceM: number,
  lane: LaneIndex,
): number {
  const firstModule = Math.floor(Math.max(0, distanceM) / MODULE_LENGTH_M);
  for (let offset = 0; offset <= 20; offset += 1) {
    const transition = roadModuleAt(seed, firstModule + offset).transition;
    if (
      transition?.kind === 'remove' &&
      transition.lane === lane &&
      transition.warningEndM > distanceM + 1e-9
    ) {
      return transition.warningEndM;
    }
  }
  return Number.POSITIVE_INFINITY;
}

export function isSteadyRoadRange(
  seed: number,
  startM: number,
  endM: number,
): boolean {
  const first = Math.floor(Math.max(0, startM) / MODULE_LENGTH_M);
  const last = Math.floor(Math.max(0, endM) / MODULE_LENGTH_M);
  for (let index = first; index <= last; index += 1) {
    if (roadModuleAt(seed, index).transition) return false;
  }
  return laneMaskAt(seed, startM) === laneMaskAt(seed, endM);
}

/** First taper boundary strictly ahead, found within one bounded 2 km epoch. */
export function nextTaperStartM(seed: number, distanceM: number): number {
  const firstModule = Math.floor(Math.max(0, distanceM) / MODULE_LENGTH_M);
  for (let offset = 0; offset <= 20; offset += 1) {
    const transition = roadModuleAt(seed, firstModule + offset).transition;
    if (transition && transition.warningEndM > distanceM + 1e-9) {
      return transition.warningEndM;
    }
  }
  return Number.POSITIVE_INFINITY;
}

export function nudgeGateToSteadyRoad(
  seed: number,
  requestedM: number,
  minimumM = 600,
  forwardClearM = GATE_FORWARD_STEADY_M,
): number | null {
  const originM = Math.max(minimumM, requestedM);
  const floorM = minimumM;
  // Search symmetrically around the difficulty target. Looking backward (but
  // never inside the requested exclusion) avoids phase-locking short gaps
  // to the following topology epoch.
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const offsetM = attempt * (MODULE_LENGTH_M / 20);
    const backwardM = originM - offsetM;
    const forwardM = originM + offsetM;
    if (
      backwardM >= floorM &&
      isSteadyRoadRange(
        seed,
        backwardM - GATE_APPROACH_CLEAR_M,
        backwardM + forwardClearM,
      )
    ) {
      return backwardM;
    }
    if (
      offsetM > 0 &&
      isSteadyRoadRange(
        seed,
        forwardM - GATE_APPROACH_CLEAR_M,
        forwardM + forwardClearM,
      )
    ) {
      return forwardM;
    }
  }
  return null;
}

export function moduleTopologySignature(seed: number, epoch: number): string {
  const masks: number[] = [];
  for (let local = 0; local < 20; local += 1) {
    const roadModule = roadModuleAt(seed, epoch * 20 + local);
    masks.push(roadModule.fromLaneMask, roadModule.toLaneMask);
  }
  return masks.join(',');
}
