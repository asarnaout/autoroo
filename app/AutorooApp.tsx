'use client';

import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefAttributes,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Gauge, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { ASSET_CREDITS } from './game/assets';
import { LANE_X, countLanes } from './game/constants';
import { laneMaskAt } from './game/generator';
import type { GameEvent, RunSnapshot } from './game/contracts';
import type { GameCanvasHandle, GameCanvasProps } from './game/GameCanvas';
import { loadBest, saveBest } from './game/persistence';

const GameCanvas = dynamic<GameCanvasProps & RefAttributes<GameCanvasHandle>>(
  () => import('./game/GameCanvas'),
  {
    ssr: false,
    loading: () => <div className="game-loading">Warming up the road…</div>,
  },
);

const INITIAL_SEED = 0xa770_2026;
const INITIAL_LANE_MASK = laneMaskAt(INITIAL_SEED, 0);

const INITIAL_SNAPSHOT: RunSnapshot = {
  version: 1,
  seed: INITIAL_SEED,
  tick: 0,
  phase: 'ready',
  elapsedS: 0,
  player: {
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
  },
  traffic: [],
  score: 0,
  bonusScore: 0,
  difficulty: 0,
  laneMask: INITIAL_LANE_MASK,
  laneCount: countLanes(INITIAL_LANE_MASK),
  rearWarning: false,
  activeCertificate: null,
  lastBonusLabel: null,
};

function formatScore(score: number): string {
  return Math.max(0, Math.floor(score)).toString().padStart(6, '0');
}

function statusPayload(snapshot: RunSnapshot, best: number) {
  return {
    phase: snapshot.phase,
    score: snapshot.score,
    best,
    distanceMetres: Math.floor(snapshot.player.maxForwardM),
    speedMetresPerSecond: Number(snapshot.player.speedMps.toFixed(2)),
    lane: snapshot.player.lane + 1,
    activeLanes: snapshot.laneCount,
    rearPressureWarning: snapshot.rearWarning,
    jumpGateVisible: snapshot.activeCertificate?.kind === 'jump',
  };
}

export function AutorooApp() {
  const gameRef = useRef<GameCanvasHandle>(null);
  const snapshotRef = useRef<RunSnapshot>(INITIAL_SNAPSHOT);
  const bestRef = useRef(0);
  const scoreDeltaTimerRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [best, setBest] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [muted, setMuted] = useState(false);
  const [scoreDelta, setScoreDelta] = useState(0);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = loadBest();
      bestRef.current = stored;
      setBest(stored);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    return () => {
      if (scoreDeltaTimerRef.current !== null)
        window.clearTimeout(scoreDeltaTimerRef.current);
    };
  }, []);

  const clearScoreDelta = useCallback(() => {
    if (scoreDeltaTimerRef.current !== null) {
      window.clearTimeout(scoreDeltaTimerRef.current);
      scoreDeltaTimerRef.current = null;
    }
    setScoreDelta(0);
  }, []);

  const onSnapshot = useCallback(
    (next: RunSnapshot) => {
      const previousPhase = snapshotRef.current.phase;
      snapshotRef.current = next;
      setSnapshot(next);
      if (previousPhase === 'running' && next.phase !== 'running')
        clearScoreDelta();
      if (next.score > bestRef.current) {
        bestRef.current = next.score;
        setBest(next.score);
      }
      if (next.phase === 'game-over' && next.score > loadBest())
        saveBest(next.score);
    },
    [clearScoreDelta],
  );

  const onEvent = useCallback((event: GameEvent) => {
    if (event.type !== 'bonus') return;
    setScoreDelta((current) => current + event.points);
    if (scoreDeltaTimerRef.current !== null)
      window.clearTimeout(scoreDeltaTimerRef.current);
    scoreDeltaTimerRef.current = window.setTimeout(() => {
      scoreDeltaTimerRef.current = null;
      setScoreDelta(0);
    }, 900);
  }, []);

  const onReady = useCallback(() => setSceneReady(true), []);
  const onLoadProgress = useCallback(
    (progress: number) => setLoadProgress(progress),
    [],
  );

  const startRun = useCallback(() => {
    clearScoreDelta();
    gameRef.current?.start();
  }, [clearScoreDelta]);

  const restartRun = useCallback(() => {
    clearScoreDelta();
    gameRef.current?.restart();
  }, [clearScoreDelta]);

  const setPauseState = useCallback((paused: boolean) => {
    gameRef.current?.setPaused(paused);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      gameRef.current?.setMuted(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<typeof context.registerTool>[0]) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch((error) =>
          console.warn('[Autoroo WebMCP] Registration failed', error),
        );
      } catch (error) {
        console.warn('[Autoroo WebMCP] Registration failed', error);
      }
    };

    register({
      name: 'read_autoroo_run_status',
      title: 'Read Autoroo run status',
      description: 'Read the same current run status shown in the Autoroo HUD.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() {
        return statusPayload(snapshotRef.current, bestRef.current);
      },
    });
    register({
      name: 'start_autoroo_run',
      title: 'Start Autoroo run',
      description:
        'Start the ready Autoroo run, equivalent to the visible Start driving button.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        if (snapshotRef.current.phase !== 'ready')
          throw new Error('The run is not on the start screen.');
        if (!gameRef.current?.isReady())
          throw new Error('The game is still loading.');
        startRun();
        return statusPayload(
          gameRef.current?.snapshot() ?? snapshotRef.current,
          bestRef.current,
        );
      },
    });
    register({
      name: 'set_autoroo_pause_state',
      title: 'Set Autoroo pause state',
      description:
        'Pause or resume the active run, equivalent to the visible pause controls.',
      inputSchema: {
        type: 'object',
        properties: { paused: { type: 'boolean' } },
        required: ['paused'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (
          typeof input !== 'object' ||
          input === null ||
          typeof (input as { paused?: unknown }).paused !== 'boolean'
        ) {
          throw new Error('paused must be a boolean.');
        }
        if (!['running', 'paused'].includes(snapshotRef.current.phase)) {
          throw new Error('There is no active run to pause or resume.');
        }
        setPauseState((input as { paused: boolean }).paused);
        return statusPayload(
          gameRef.current?.snapshot() ?? snapshotRef.current,
          bestRef.current,
        );
      },
    });
    register({
      name: 'restart_autoroo_run',
      title: 'Restart Autoroo run',
      description:
        'Restart after a crash, equivalent to the visible Drive again button.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        if (snapshotRef.current.phase !== 'game-over')
          throw new Error('Restart is available after a crash.');
        restartRun();
        return statusPayload(
          gameRef.current?.snapshot() ?? snapshotRef.current,
          bestRef.current,
        );
      },
    });
    return () => lifecycle.abort();
  }, [restartRun, setPauseState, startRun]);

  const speedMph = Math.round(snapshot.player.speedMps * 2.23694);
  const isPlaying = snapshot.phase === 'running';

  return (
    <main className="autoroo-shell">
      <GameCanvas
        ref={gameRef}
        muted={muted}
        onReady={onReady}
        onLoadProgress={onLoadProgress}
        onSnapshot={onSnapshot}
        onEvent={onEvent}
      />

      <div className="hud-top" aria-label="Game status">
        <div className="score-chip">
          <div className="score-chip-label">
            <span>SCORE</span>
            {scoreDelta > 0 && (
              <output className="score-delta" aria-hidden="true">
                +{scoreDelta}
              </output>
            )}
          </div>
          <strong>{formatScore(snapshot.score)}</strong>
        </div>
        <Button
          className="hud-icon-button"
          variant="ghost"
          size="icon"
          aria-label={muted ? 'Unmute sound' : 'Mute sound'}
          onClick={toggleMuted}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
        {isPlaying && (
          <Button
            className="hud-icon-button"
            variant="ghost"
            size="icon"
            aria-label="Pause game"
            onClick={() => setPauseState(true)}
          >
            <Pause />
          </Button>
        )}
        <div className="score-chip best-chip">
          <span>PERSONAL BEST</span>
          <strong>{formatScore(best)}</strong>
        </div>
      </div>

      <div className="speed-chip" aria-label={`${speedMph} miles per hour`}>
        <Gauge aria-hidden="true" />
        <strong>{speedMph}</strong>
        <span>MPH</span>
      </div>

      {snapshot.phase === 'ready' && (
        <section className="start-card" aria-labelledby="autoroo-title">
          <p className="eyebrow">ENDLESS FUN. QUESTIONABLE DRIVING</p>
          <h1 id="autoroo-title">
            AUTO<span>ROO</span>
          </h1>
          <div className="control-strip" aria-label="Keyboard controls">
            <span>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> flip lanes
            </span>
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> speed
            </span>
            <span>
              <Kbd>Space</Kbd> jump
            </span>
          </div>
          <Button
            className="play-button"
            size="lg"
            disabled={!sceneReady}
            onClick={startRun}
          >
            <Play fill="currentColor" />
            {sceneReady
              ? 'Start driving'
              : `Loading city ${Math.round(loadProgress * 100)}%`}
          </Button>
          <div className="start-actions">
            <Button variant="ghost" size="sm" onClick={toggleMuted}>
              {muted ? <VolumeX /> : <Volume2 />}
              {muted ? 'Muted' : 'Sound on'}
            </Button>
          </div>
        </section>
      )}

      {snapshot.phase === 'paused' && (
        <section
          className="overlay-card compact-card"
          aria-labelledby="paused-title"
        >
          <p className="eyebrow">PARKED, TECHNICALLY</p>
          <h2 id="paused-title">Paused</h2>
          <p>Your streak is safe. The traffic is pretending not to stare.</p>
          <Button className="play-button" onClick={() => setPauseState(false)}>
            <Play fill="currentColor" /> Resume
          </Button>
          <p className="key-hint">
            or press <Kbd>Esc</Kbd>
          </p>
          <CreditsDialog />
        </section>
      )}

      {snapshot.phase === 'game-over' && (
        <section
          className="overlay-card crash-card"
          aria-labelledby="crash-title"
        >
          <p className="eyebrow">BONK DETECTED</p>
          <h2 id="crash-title">Road trip over.</h2>
          <div className="crash-score">
            <span>FINAL SCORE</span>
            <strong>{formatScore(snapshot.score)}</strong>
            <small>
              {Math.floor(snapshot.player.maxForwardM)} m driven · +
              {snapshot.bonusScore} bonus
            </small>
          </div>
          <Button className="play-button" onClick={restartRun}>
            <RotateCcw /> Drive again
          </Button>
          <p className="key-hint">
            press <Kbd>Enter</Kbd> or <Kbd>R</Kbd>
          </p>
        </section>
      )}

      {isPlaying && snapshot.rearWarning && (
        <div className="rear-warning" role="alert">
          TRAFFIC CATCHING UP — HOLD <Kbd>↑</Kbd>
        </div>
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {snapshot.phase === 'game-over'
          ? `Game over. Score ${snapshot.score}.`
          : scoreDelta > 0
            ? `Score increased by ${scoreDelta} points.`
            : ''}
      </div>
    </main>
  );
}

function CreditsDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Credits
      </DialogTrigger>
      <DialogContent className="credits-dialog">
        <DialogHeader>
          <DialogTitle>Asset credits</DialogTitle>
          <DialogDescription>
            Every imported model and music track is pinned to a credit and
            SHA-256 hash. CC0 credits are retained voluntarily.
          </DialogDescription>
        </DialogHeader>
        <div className="credits-list">
          {ASSET_CREDITS.map((credit) => (
            <article key={credit.file} className="credit-row">
              <h3>{credit.title}</h3>
              <p>
                by {credit.author} ·{' '}
                <a href={credit.source} target="_blank" rel="noreferrer">
                  source
                </a>{' '}
                ·{' '}
                <a href={credit.licenseUrl} target="_blank" rel="noreferrer">
                  {credit.license}
                </a>
              </p>
              <p className="credit-note">{credit.modificationNotes}</p>
              <code>{credit.file.split('/').at(-1)}</code>
            </article>
          ))}
        </div>
        <p className="credits-footnote">
          Adapted procedural road and presentation techniques retain Curbside
          Rush’s MIT notice. The purchased London double-decker and all map/OSM
          data are explicitly excluded.
        </p>
      </DialogContent>
    </Dialog>
  );
}
