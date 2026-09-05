# Mobile quality and performance audit — 2026-09-05

Baseline: `6c57ed4f2698c5aa0786516fcea97c8bb186a6f3`.

## Resolution regression

The old controller interpreted frame cadence as rendering cost. At steady 30 FPS, a DPR 3 phone stepped down to DPR 1 after 60 seconds and could not recover at either 30 or 50 FPS. For a 402 × 874 CSS viewport, this meant 402 × 874 rendered pixels instead of 1206 × 2622: nine times fewer pixels. The DOM HUD was unaffected, explaining the contrast between sharp text and soft scenery.

Babylon's frame delta includes browser scheduling delay. WebKit documents intentional 30 Hz throttling in low power mode; the supplied screenshot alone cannot establish whether throttling or rendering load caused that particular session. [WebKit explanation](https://bugs.webkit.org/show_bug.cgi?id=215745)

The corrected controller:

- Keeps native quality, within the existing 3.5-megapixel budget, at stable 30–120 FPS.
- Reduces only after sustained frame times above 40 ms, with two-second warmup and measurement windows.
- Recovers at healthy 30 Hz cadence, with four healthy windows before each increase.
- Keeps at least DPR 2 where the native DPR and pixel budget permit it.
- Preserves orientation handling and ignores duplicate resize notifications, loading, pause and long stalls.

This deliberately prioritizes clarity at 30–60 FPS. A device that sustains 30 FPS only at reduced quality can still alternate between adjacent quality levels as the controller periodically attempts recovery. Frame cadence cannot perfectly distinguish an OS cap from GPU pressure.

## Implemented optimizations

| Area | Change | Evidence |
| --- | --- | --- |
| Traffic simulation | Reuse the existing longitudinal-overlap rejection; scan only the drafted blockers when checking a traffic proof; retain immutable road modules in a bounded 128-slot cache | About 18% less simulation CPU in the benchmark below |
| Idle rendering | Retain the completed scene during title, pause and settled game-over screens; redraw on resource readiness, resize, visibility return and context restoration | Actual frame-loop test renders once across 600 unchanged idle callbacks; gameplay and the entire crash continue rendering |
| Materials | Freeze immutable building and booster materials; share four puff materials instead of sixteen | Existing material colors, shading and per-mesh opacity preserved |
| Booster animation | Skip transforms for disabled pickup variants and inactive puffs | Current transforms are recomputed on activation; existing effect/geometry tests pass |

No traffic density, difficulty, movement, collision dimensions, booster rules, camera layout, UI or authored model geometry changed.

## Measurements and regression checks

Three sequential Node trials per simulation variant; each trial ran 60,000 deterministic bot-driven ticks, covering 51.16 km with the default seed. Timed simulation work excludes the bot's input calculation and snapshot timing.

| Measurement | Baseline | Combined optimization |
| --- | ---: | ---: |
| Median total simulation CPU | 2484.6 ms | 2045.9 ms |
| p99 simulation tick | 0.861 ms | 0.671 ms |

These are local Node CPU measurements, **not measured iPhone FPS**.

The actual checkout was separately compared with the saved baseline over 240,000 ticks across four seeds: every event matched, all 8,588 generated certificates matched exactly, all 2,400 sampled snapshots and complete state hashes matched, and 2,000 road-module outputs matched. Explicit retirement-boundary witness cases also matched.

Validation passed:

- Full regression suite, followed by the added cadence and pause-audio checks.
- One million generated road modules and 100 km runs for each of three seeds, including density, solvability and retained-state bounds.
- TypeScript, lint, production build and diff whitespace checks.
- Local browser mobile/desktop layout, canvas sizing, initial model readiness, retained pause scene, resume and settled game-over/restart UI. No browser console errors observed.

The mobile browser viewport emulator uses DPR 1; the DPR 3 framebuffer and sustained-cadence cases are covered in the quality-controller tests. Physical iPhone thermal behavior, GPU timings and low-power-mode FPS remain unmeasured. Existing build warnings about a large JavaScript chunk and the development-only preview route remain.

## Further opportunities requiring separate visual profiling

Traffic blob-shadow instancing and merging vehicle primitives with identical materials could reduce draw calls further. They were not applied: transparent sorting and imported transform handling need dedicated WebGL comparison before changing that rendering path. Existing vehicle/building instancing, fixed visual pools and 10 Hz HUD snapshots already avoid substantial repeated work.

Gameplay is local to the browser. Static asset delivery and initial JavaScript/model parsing affect startup, but no server game loop or recurring gameplay network request was found that would explain resolution degrading during a run.
