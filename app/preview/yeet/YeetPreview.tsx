'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { YeetBurst, useYeetBurst } from '../../game/YeetBurst';

export function YeetPreview() {
  const { burstId, ready, play } = useYeetBurst();

  useEffect(() => {
    if (ready) play();
  }, [ready, play]);

  return (
    <main className="yeet-preview">
      <YeetBurst burstId={burstId} />
      <div className="yeet-preview-controls">
        <Button
          className="yeet-preview-replay"
          onClick={play}
          disabled={!ready}
        >
          <RotateCcw aria-hidden="true" />
          {ready ? 'Replay YEEEET' : 'Loading sticker…'}
        </Button>
        <Link href="/">Back to the game</Link>
      </div>
    </main>
  );
}
