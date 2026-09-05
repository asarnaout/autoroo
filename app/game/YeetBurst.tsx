'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

export const YEET_BURST_IMAGE = '/images/effects/yeeeet-burst.png';
const YEET_BURST_DURATION_MS = 1000;

/** Preload on the start screen so collection can show the sticker immediately. */
export function useYeetBurst() {
  const [burstId, setBurstId] = useState(0);
  const [ready, setReady] = useState(false);
  const sequence = useRef(0);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    sequence.current += 1;
    setBurstId(0);
  }, []);

  const play = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const id = ++sequence.current;
    setBurstId(id);
    timer.current = window.setTimeout(() => {
      if (sequence.current !== id) return;
      timer.current = null;
      setBurstId(0);
    }, YEET_BURST_DURATION_MS);
  }, []);

  useEffect(() => {
    const preload = new window.Image();
    preload.onload = () => setReady(true);
    preload.src = YEET_BURST_IMAGE;
    return () => {
      preload.onload = null;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return { burstId, ready, play, clear };
}

export function YeetBurst({ burstId }: { readonly burstId: number }) {
  if (burstId === 0) return null;
  return (
    <div
      className="yeet-burst"
      key={burstId}
      aria-hidden="true"
      style={
        {
          '--yeet-duration': `${YEET_BURST_DURATION_MS}ms`,
        } as React.CSSProperties
      }
    >
      <Image
        className="yeet-burst-sticker"
        src={YEET_BURST_IMAGE}
        alt=""
        width={1536}
        height={1024}
        unoptimized
        loading="eager"
        draggable={false}
      />
    </div>
  );
}
