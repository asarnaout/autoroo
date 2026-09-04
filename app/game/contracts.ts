export type LaneIndex = 0 | 1 | 2 | 3;
export type LaneMask = number;
export type RunPhase = 'ready' | 'running' | 'paused' | 'game-over';
export type VehicleKind = 'sedan' | 'suv' | 'bus';
export type VehicleRole = 'ordinary' | 'gate' | 'rear-pressure';

export interface InputFrame {
  readonly accelerate: boolean;
  readonly brake: boolean;
  readonly laneDelta: -1 | 0 | 1;
  readonly jumpPressed: boolean;
}

export interface PlayerState {
  lane: LaneIndex;
  /** Physical lateral centre; `lane` is the committed destination. */
  xM: number;
  previousXM: number;
  laneChangeStartXM: number;
  laneChangeElapsedS: number;
  laneChangeDirection: -1 | 0 | 1;
  queuedLane: LaneIndex | null;
  absoluteZM: number;
  previousZM: number;
  yM: number;
  previousYM: number;
  speedMps: number;
  verticalSpeedMps: number;
  airborne: boolean;
  takeoffSpeedMps: number;
  jumpElapsedS: number;
  maxForwardM: number;
}

export interface TrafficVehicle {
  id: string;
  encounterId: string;
  kind: VehicleKind;
  role: VehicleRole;
  lane: LaneIndex;
  absoluteZM: number;
  previousZM: number;
  speedMps: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  airborneOverlap: boolean;
  closePassOverlap: boolean;
  bonusAwarded: boolean;
  locked: boolean;
  certificateId: string | null;
  /** Immutable forward boundary where an ordinary encounter leaves the road. */
  retireAtZM: number | null;
}

export interface RoadTransition {
  readonly kind: 'add' | 'remove';
  readonly lane: LaneIndex;
  readonly warningEndM: number;
  readonly taperEndM: number;
}

export interface RoadModule {
  readonly index: number;
  readonly startM: number;
  readonly endM: number;
  readonly fromLaneMask: LaneMask;
  readonly toLaneMask: LaneMask;
  readonly transition: RoadTransition | null;
  readonly trafficAllowed: boolean;
}

export interface WitnessTracePoint {
  readonly tick: number;
  readonly lane: LaneIndex;
  readonly xMM: number;
  readonly zMM: number;
  readonly yMM: number;
  readonly speedMMps: number;
  readonly input: InputFrame;
}

export interface ChallengeCertificate {
  readonly version: 1;
  readonly id: string;
  readonly kind: 'ground' | 'jump';
  readonly gateSeed: number;
  readonly locked: boolean;
  readonly revealTick: number;
  readonly lockedStateHash: string;
  readonly dependencyHash: string;
  readonly targetLane: LaneIndex;
  readonly selectedVehicle: VehicleKind;
  readonly blockerIds: readonly string[];
  readonly blockerTrajectories: readonly {
    id: string;
    lane: LaneIndex;
    startTick: number;
    startZM: number;
    speedMps: number;
    retireAtZM: number | null;
  }[];
  readonly safeTakeoffTickMin: number;
  readonly safeTakeoffTickMax: number;
  readonly minimumSpeedMps: number;
  readonly targetSpeedMps: number;
  readonly verticalClearanceM: number;
  readonly longitudinalMarginM: number;
  readonly timingMarginTicks: number;
  readonly inputWindowS: number;
  readonly witnessTraceHash: string;
  readonly witness: readonly WitnessTracePoint[];
}

export interface RunSnapshot {
  readonly version: 1;
  readonly seed: number;
  readonly tick: number;
  readonly phase: RunPhase;
  readonly elapsedS: number;
  readonly player: Readonly<PlayerState>;
  readonly traffic: readonly Readonly<TrafficVehicle>[];
  readonly score: number;
  readonly bonusScore: number;
  readonly difficulty: number;
  readonly laneMask: LaneMask;
  readonly laneCount: number;
  readonly rearWarning: boolean;
  readonly activeCertificate: ChallengeCertificate | null;
  readonly lastBonusLabel: string | null;
}

export interface AssetCredit {
  readonly file: string;
  readonly sha256: string;
  readonly author: string;
  readonly title: string;
  readonly source: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly modificationNotes: string;
}

export type GameEvent =
  | { readonly type: 'jump' }
  | { readonly type: 'lane-change' }
  | { readonly type: 'warning' }
  | { readonly type: 'horn' }
  | { readonly type: 'crash' }
  | { readonly type: 'bonus'; readonly label: string; readonly points: number };
