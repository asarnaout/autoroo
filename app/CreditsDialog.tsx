'use client';

import type { ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ASSET_CREDITS, MODEL_URLS, MUSIC_URLS } from './game/assets';

const bus = ASSET_CREDITS.find((asset) => asset.file === MODEL_URLS.bus)!;
const music = ASSET_CREDITS.find(
  (asset) => asset.file === MUSIC_URLS.peckhamMarketRoute,
)!;
const sceneryCreators = ['Quaternius', 'Kenney', 'Kay Lousberg'];

function CreditLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function CreditsDialog() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            className="start-utility-button start-credits-button"
            variant="ghost"
            size="icon"
          />
        }
        aria-label="About and credits"
        title="About and credits"
      >
        <Info aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="credits-dialog" showCloseButton={false}>
        <div className="credits-heading">
          <div>
            <DialogTitle>Credits</DialogTitle>
            <DialogDescription>
              Art, music &amp; the people behind them.
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button className="credits-close" variant="ghost" size="icon" />
            }
            aria-label="Close credits"
          >
            <X aria-hidden="true" />
          </DialogClose>
        </div>

        <div className="credits-body">
          <section aria-labelledby="credits-bus-title">
            <h3 id="credits-bus-title">The bus</h3>
            <p>
              <CreditLink href={bus.source}>“Bus” by jeremy</CreditLink> via
              Poly Pizza ·{' '}
              <CreditLink href={bus.licenseUrl}>{bus.license}</CreditLink>
            </p>
            <p>
              Body and window colours, lighting, and materials adapted for
              Autoroo.
            </p>
          </section>

          <section aria-labelledby="credits-city-title">
            <h3 id="credits-city-title">Cars, buildings &amp; trees</h3>
            <p>
              {sceneryCreators.map((author, index) => {
                const asset = ASSET_CREDITS.find(
                  (credit) => credit.author === author,
                )!;
                return (
                  <span key={author}>
                    {index > 0 && ' · '}
                    <CreditLink href={asset.source}>{author}</CreditLink>
                  </span>
                );
              })}
            </p>
            <p>
              <CreditLink href="https://creativecommons.org/publicdomain/zero/1.0/">
                CC0 public domain
              </CreditLink>
              . Some colours and materials adapted.
            </p>
          </section>

          <section aria-labelledby="credits-music-title">
            <h3 id="credits-music-title">Music</h3>
            <p>
              Created by <CreditLink href={music.source}>Suno</CreditLink> and
              supplied by the game creator under paid plan rights.
            </p>
          </section>

          <section aria-labelledby="credits-type-title">
            <h3 id="credits-type-title">Type &amp; icons</h3>
            <p>
              Lilita One · © 2011 Juan Montoreano ·{' '}
              <CreditLink href="/fonts/OFL-LilitaOne.txt">
                Open Font License
              </CreditLink>
            </p>
            <p>
              Lucide Icons &amp; Contributors ·{' '}
              <CreditLink href="/licenses/lucide.txt">
                License notices
              </CreditLink>
            </p>
          </section>

          <section aria-labelledby="credits-original-title">
            <h3 id="credits-original-title">Made for Autoroo</h3>
            <p>
              Menu artwork created with OpenAI. Original booster designs and
              synthesized sound effects.
            </p>
          </section>
        </div>

        <DialogClose render={<Button className="credits-done" />}>
          Back to game
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
