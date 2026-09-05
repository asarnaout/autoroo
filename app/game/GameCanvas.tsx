'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { GameEvent, RunSnapshot } from './contracts';
import { BabylonGameSession } from './BabylonGameSession';
import type { DrivingControl } from './input';

export interface GameCanvasHandle {
  start(): void;
  restart(): void;
  setPaused(paused: boolean): void;
  setMuted(muted: boolean): void;
  setTouchDriving(enabled: boolean): void;
  controlDown(control: DrivingControl, source: string): void;
  controlUp(source: string): void;
  snapshot(): RunSnapshot | null;
  isReady(): boolean;
}

export interface GameCanvasProps {
  readonly muted: boolean;
  readonly onReady: () => void;
  readonly onLoadProgress: (progress: number) => void;
  readonly onSnapshot: (snapshot: RunSnapshot) => void;
  readonly onEvent: (event: GameEvent) => void;
  readonly onCrashAnimationComplete: () => void;
}

const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(
  function GameCanvas(
    {
      muted,
      onReady,
      onLoadProgress,
      onSnapshot,
      onEvent,
      onCrashAnimationComplete,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sessionRef = useRef<BabylonGameSession | null>(null);
    const pendingActionRef = useRef<null | 'start' | 'restart'>(null);

    useImperativeHandle(
      ref,
      () => ({
        start() {
          const session = sessionRef.current;
          if (session) session.start();
          else pendingActionRef.current = 'start';
        },
        restart() {
          const session = sessionRef.current;
          if (session) session.restart();
          else pendingActionRef.current = 'restart';
        },
        setPaused(paused) {
          sessionRef.current?.setPaused(paused);
        },
        setMuted(value) {
          sessionRef.current?.setMuted(value);
        },
        setTouchDriving(enabled) {
          sessionRef.current?.setTouchDriving(enabled);
        },
        controlDown(control, source) {
          sessionRef.current?.controlDown(control, source);
        },
        controlUp(source) {
          sessionRef.current?.controlUp(source);
        },
        snapshot() {
          return sessionRef.current?.snapshot() ?? null;
        },
        isReady() {
          return sessionRef.current?.isReady() ?? false;
        },
      }),
      [],
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const session = new BabylonGameSession(canvas, {
        onReady: () => {
          onReady();
          const pending = pendingActionRef.current;
          pendingActionRef.current = null;
          if (pending === 'start') session.start();
          if (pending === 'restart') session.restart();
        },
        onLoadProgress,
        onSnapshot,
        onEvent,
        onCrashAnimationComplete,
      });
      sessionRef.current = session;
      const pending = pendingActionRef.current;
      pendingActionRef.current = null;
      if (pending === 'start') session.start();
      if (pending === 'restart') session.restart();
      return () => {
        sessionRef.current = null;
        session.dispose();
      };
    }, [
      onEvent,
      onLoadProgress,
      onReady,
      onSnapshot,
      onCrashAnimationComplete,
    ]);

    useEffect(() => {
      sessionRef.current?.setMuted(muted);
    }, [muted]);

    return (
      <canvas
        ref={canvasRef}
        className="game-canvas"
        aria-label="Autoroo 3D driving game"
      />
    );
  },
);

export default GameCanvas;
