import { describe, expect, it } from 'vitest';
import {
  FOUR_LANES,
  GATE_APPROACH_CLEAR_M,
  GATE_FORWARD_STEADY_M,
  LANE_X,
  THREE_LEFT,
  THREE_RIGHT,
  TWO_LANES,
  activeLanes,
  countLanes,
  difficultyAt,
} from '../app/game/constants';
import {
  chooseEscapeLane,
  firstGateDistance,
  isSteadyRoadRange,
  laneMaskAt,
  moduleTopologySignature,
  nextGateDistance,
  nudgeGateToSteadyRoad,
  ordinaryGapM,
  roadModuleAt,
  scheduledGateDistance,
  visualRoadProfileAt,
  visualRoadTileProfile,
} from '../app/game/generator';
import type { LaneIndex } from '../app/game/contracts';

describe('procedural road topology', () => {
  it('uses four permanent lane anchors', () => {
    expect(LANE_X).toEqual([-5.4, -1.8, 1.8, 5.4]);
  });

  it('starts at three lanes and walks legally through 3→2→3→4→3', () => {
    const legalMasks = new Set([
      TWO_LANES,
      THREE_LEFT,
      THREE_RIGHT,
      FOUR_LANES,
    ]);
    for (let seed = 0; seed < 1000; seed += 1) {
      for (let epoch = 0; epoch < 3; epoch += 1) {
        expect(countLanes(roadModuleAt(seed, epoch * 20).fromLaneMask)).toBe(3);
        let sawTwo = false;
        let sawFour = false;
        let transitions = 0;
        for (let local = 0; local < 20; local += 1) {
          const roadModule = roadModuleAt(seed, epoch * 20 + local);
          expect(legalMasks.has(roadModule.fromLaneMask)).toBe(true);
          expect(legalMasks.has(roadModule.toLaneMask)).toBe(true);
          sawTwo ||= roadModule.fromLaneMask === TWO_LANES;
          sawFour ||= roadModule.fromLaneMask === FOUR_LANES;
          if (roadModule.transition) {
            transitions += 1;
            expect(
              Math.abs(
                countLanes(roadModule.fromLaneMask) -
                  countLanes(roadModule.toLaneMask),
              ),
            ).toBe(1);
            expect(roadModule.trafficAllowed).toBe(false);
            expect(roadModule.transition.warningEndM - roadModule.startM).toBe(
              50,
            );
            expect(
              roadModule.transition.taperEndM -
                roadModule.transition.warningEndM,
            ).toBe(50);
          }
        }
        expect({ sawTwo, sawFour, transitions }).toEqual({
          sawTwo: true,
          sawFour: true,
          transitions: 4,
        });
      }
    }
  });

  it('makes steady three-lane road much more common than two-lane road', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      for (let epoch = 0; epoch < 3; epoch += 1) {
        const steadyByLaneCount = new Map<number, number>();
        for (let local = 0; local < 20; local += 1) {
          const roadModule = roadModuleAt(seed, epoch * 20 + local);
          if (!roadModule.trafficAllowed) continue;
          const laneCount = countLanes(roadModule.fromLaneMask);
          steadyByLaneCount.set(
            laneCount,
            (steadyByLaneCount.get(laneCount) ?? 0) + 1,
          );
        }
        expect(steadyByLaneCount.get(2)).toBe(2);
        expect(steadyByLaneCount.get(3)).toBe(8);
        expect(steadyByLaneCount.get(4)).toBe(6);
        expect(steadyByLaneCount.get(3)).toBeGreaterThan(
          steadyByLaneCount.get(2)!,
        );
      }
    }
  });

  it('devotes most playable road distance to three lanes', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      for (let epoch = 0; epoch < 4; epoch += 1) {
        const samplesByLaneCount = new Map<number, number>();
        for (let local = 0; local < 20; local += 1) {
          for (const offsetM of [25, 75]) {
            const laneCount = countLanes(
              laneMaskAt(seed, (epoch * 20 + local) * 100 + offsetM),
            );
            samplesByLaneCount.set(
              laneCount,
              (samplesByLaneCount.get(laneCount) ?? 0) + 1,
            );
          }
        }
        expect(samplesByLaneCount.get(2)).toBe(7);
        expect(samplesByLaneCount.get(3)).toBe(20);
        expect(samplesByLaneCount.get(4)).toBe(13);
      }
    }
  });

  it('is stateless and independent of generation order', () => {
    const ordered = Array.from({ length: 20 }, (_, index) =>
      roadModuleAt(919, index),
    );
    const shuffled = [
      9, 1, 19, 0, 13, 7, 4, 12, 3, 18, 2, 5, 6, 8, 10, 11, 14, 15, 16, 17,
    ]
      .map((index) => roadModuleAt(919, index))
      .sort((a, b) => a.index - b.index);
    expect(shuffled).toEqual(ordered);
    expect(moduleTopologySignature(919, 0)).toBe(
      moduleTopologySignature(919, 0),
    );
  });

  it('keeps topology continuous across module and epoch seams', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      for (let index = 0; index < 80; index += 1) {
        expect(roadModuleAt(seed, index).toLaneMask).toBe(
          roadModuleAt(seed, index + 1).fromLaneMask,
        );
      }
      for (let start = 0; start < 40; start += 1) {
        const masks = Array.from(
          { length: 20 },
          (_, offset) => roadModuleAt(seed, start + offset).fromLaneMask,
        );
        expect(masks).toContain(TWO_LANES);
        expect(masks).toContain(FOUR_LANES);
      }
    }
  });

  it('keeps the visual and gameplay lane masks identical throughout tapers', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      for (let moduleIndex = 0; moduleIndex < 40; moduleIndex += 1) {
        const roadModule = roadModuleAt(seed, moduleIndex);
        for (const offsetM of [0, 49.9, 50, 75, 99.9]) {
          const zM = roadModule.startM + offsetM;
          expect(visualRoadProfileAt(seed, zM).laneMask).toBe(
            laneMaskAt(seed, zM),
          );
        }
      }
    }
  });

  it('keeps a changing lane inaccessible for the full curved taper', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      for (let moduleIndex = 0; moduleIndex < 40; moduleIndex += 1) {
        const roadModule = roadModuleAt(seed, moduleIndex);
        const transition = roadModule.transition;
        if (!transition) continue;
        const beforeTaper = laneMaskAt(seed, transition.warningEndM - 0.001);
        const afterTaper = laneMaskAt(seed, transition.taperEndM);
        for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
          const mask = laneMaskAt(seed, transition.warningEndM + progress * 50);
          expect(
            (mask & (1 << transition.lane)) !== 0,
            `${transition.kind} lane ${transition.lane} at ${progress}`,
          ).toBe(false);
        }
        if (transition.kind === 'add') {
          expect((beforeTaper & (1 << transition.lane)) !== 0).toBe(false);
          expect((afterTaper & (1 << transition.lane)) !== 0).toBe(true);
        } else {
          expect((beforeTaper & (1 << transition.lane)) !== 0).toBe(true);
          expect((afterTaper & (1 << transition.lane)) !== 0).toBe(false);
        }
      }
    }
  });

  it('eases one outer road edge smoothly while the opposite edge stays fixed', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      for (let moduleIndex = 0; moduleIndex < 40; moduleIndex += 1) {
        const transition = roadModuleAt(seed, moduleIndex).transition;
        if (!transition) continue;
        const profiles = [0, 0.25, 0.5, 0.75, 0.999999].map((progress) =>
          visualRoadProfileAt(seed, transition.warningEndM + progress * 50),
        );
        expect(profiles[1].transitionAmount).toBeCloseTo(0.15625, 8);
        expect(profiles[2].transitionAmount).toBeCloseTo(0.5, 8);
        expect(profiles[3].transitionAmount).toBeCloseTo(0.84375, 8);

        const leftEdges = profiles.map(
          (profile) => profile.centerX - profile.widthM / 2,
        );
        const rightEdges = profiles.map(
          (profile) => profile.centerX + profile.widthM / 2,
        );
        const changedEdges = transition.lane === 0 ? leftEdges : rightEdges;
        const fixedEdges = transition.lane === 0 ? rightEdges : leftEdges;
        for (const edge of fixedEdges)
          expect(edge).toBeCloseTo(fixedEdges[0], 9);
        const direction = Math.sign(changedEdges.at(-1)! - changedEdges[0]);
        expect(direction).not.toBe(0);
        for (let index = 1; index < changedEdges.length; index += 1) {
          expect(
            (changedEdges[index] - changedEdges[index - 1]) * direction,
          ).toBeGreaterThan(0);
        }

        const firstCentimetre = visualRoadProfileAt(
          seed,
          transition.warningEndM + 0.01,
        );
        const initialChangedEdge =
          transition.lane === 0
            ? profiles[0].centerX - profiles[0].widthM / 2
            : profiles[0].centerX + profiles[0].widthM / 2;
        const easedChangedEdge =
          transition.lane === 0
            ? firstCentimetre.centerX - firstCentimetre.widthM / 2
            : firstCentimetre.centerX + firstCentimetre.widthM / 2;
        expect(Math.abs(easedChangedEdge - initialChangedEdge)).toBeLessThan(
          0.000001,
        );
      }
    }
  });

  it('keeps every active fixed lane footprint on the rendered road', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      for (let moduleIndex = 0; moduleIndex < 40; moduleIndex += 1) {
        const roadModule = roadModuleAt(seed, moduleIndex);
        for (const offsetM of [0, 49.9, 50, 60, 75, 90, 99.9]) {
          const profile = visualRoadProfileAt(
            seed,
            roadModule.startM + offsetM,
          );
          const leftEdge = profile.centerX - profile.widthM / 2;
          const rightEdge = profile.centerX + profile.widthM / 2;
          for (const lane of activeLanes(profile.laneMask)) {
            expect(LANE_X[lane] - 1.8).toBeGreaterThanOrEqual(leftEdge - 1e-9);
            expect(LANE_X[lane] + 1.8).toBeLessThanOrEqual(rightEdge + 1e-9);
          }
        }
      }
    }
  });

  it('keeps coarse render tiles conservative across exact taper boundaries', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      for (let tileStartM = 0; tileStartM < 4000; tileStartM += 40) {
        const tile = visualRoadTileProfile(seed, tileStartM, tileStartM + 40);
        const leftEdgeM = tile.centerX - tile.widthM / 2;
        const rightEdgeM = tile.centerX + tile.widthM / 2;
        for (let offsetM = 0.5; offsetM < 40; offsetM += 1) {
          const mask = laneMaskAt(seed, tileStartM + offsetM);
          expect((tile.laneMask & mask) === mask).toBe(true);
          for (const lane of activeLanes(mask)) {
            expect(LANE_X[lane] - 1.8).toBeGreaterThanOrEqual(leftEdgeM - 1e-9);
            expect(LANE_X[lane] + 1.8).toBeLessThanOrEqual(rightEdgeM + 1e-9);
          }
        }
      }
    }
  });

  it('keeps consecutive escape lanes equal or adjacent and always active', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      let previous: LaneIndex = 1;
      for (let encounter = 0; encounter < 80; encounter += 1) {
        const mask = [TWO_LANES, THREE_LEFT, FOUR_LANES, THREE_RIGHT][
          encounter % 4
        ];
        const next = chooseEscapeLane(seed, encounter, mask, previous);
        expect(activeLanes(mask)).toContain(next);
        expect(Math.abs(next - previous)).toBeLessThanOrEqual(1);
        previous = next;
      }
    }
  });

  it('increases deterministic escape-lane changes with difficulty', () => {
    let earlyChanges = 0;
    let lateChanges = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      for (let encounter = 0; encounter < 10; encounter += 1) {
        earlyChanges += Number(
          chooseEscapeLane(seed, encounter, FOUR_LANES, 1, 0) !== 1,
        );
        lateChanges += Number(
          chooseEscapeLane(seed, encounter, FOUR_LANES, 1, 1) !== 1,
        );
      }
    }
    expect(lateChanges).toBeGreaterThan(earlyChanges * 2);
  });

  it('reaches most of the bounded difficulty within the first few kilometres', () => {
    expect(difficultyAt(0)).toBe(0);
    expect(difficultyAt(500)).toBeGreaterThan(0.34);
    expect(difficultyAt(1000)).toBeGreaterThan(0.56);
    expect(difficultyAt(2000)).toBeGreaterThan(0.81);
    expect(difficultyAt(4000)).toBeGreaterThan(0.96);
    expect(difficultyAt(20_000)).toBeLessThanOrEqual(1);
  });

  it('contracts ordinary encounter scheduling from roughly 112 m to 36 m', () => {
    const early: number[] = [];
    const late: number[] = [];
    for (let seed = 0; seed < 1000; seed += 1) {
      early.push(ordinaryGapM(seed, seed % 97, 0));
      late.push(ordinaryGapM(seed, seed % 97, 1));
    }
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(early)).toBeCloseTo(112, 0);
    expect(mean(late)).toBeCloseTo(36, 0);
    expect(Math.min(...early)).toBeGreaterThanOrEqual(107);
    expect(Math.max(...early)).toBeLessThanOrEqual(117);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(31);
    expect(Math.max(...late)).toBeLessThanOrEqual(41);
  });

  it('moves each scheduled gate into a transition-free reservation', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      for (let gate = 0; gate < 4; gate += 1) {
        const z = nudgeGateToSteadyRoad(
          seed,
          scheduledGateDistance(seed, gate),
        );
        expect(z).not.toBeNull();
        if (z === null) throw new Error('Expected a valid steady-road gate');
        expect(z).toBeGreaterThanOrEqual(600);
        expect(
          isSteadyRoadRange(
            seed,
            z - GATE_APPROACH_CLEAR_M,
            z + GATE_FORWARD_STEADY_M,
          ),
        ).toBe(true);
      }
    }
  });

  it('advances a deterministic O(1) gate cursor with bounded, shrinking gaps', () => {
    const earlyRequested: number[] = [];
    const lateRequested: number[] = [];
    const earlyPlaced: number[] = [];
    const latePlaced: number[] = [];
    for (let seed = 0; seed < 200; seed += 1) {
      let previous = nudgeGateToSteadyRoad(seed, firstGateDistance(seed));
      expect(previous).not.toBeNull();
      if (previous === null) throw new Error('Expected an initial gate');
      for (let gateIndex = 1; gateIndex <= 200; gateIndex += 1) {
        const requested = nextGateDistance(seed, gateIndex, previous);
        if (gateIndex <= 10) earlyRequested.push(requested - previous);
        if (gateIndex > 190) lateRequested.push(requested - previous);
        const placed = nudgeGateToSteadyRoad(seed, requested, previous + 500);
        expect(placed).not.toBeNull();
        if (placed === null) throw new Error('Expected a sequential gate');
        const gap = placed - previous;
        expect(gap).toBeGreaterThanOrEqual(500);
        if (gateIndex <= 5) earlyPlaced.push(gap);
        if (gateIndex > 180) latePlaced.push(gap);
        previous = placed;
      }
    }
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(lateRequested)).toBeLessThan(mean(earlyRequested));
    expect(mean(latePlaced)).toBeLessThan(mean(earlyPlaced) - 100);
  }, 30_000);
});
