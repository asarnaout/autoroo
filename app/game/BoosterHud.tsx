import { ChevronsUp, Shield } from 'lucide-react';
import type { BoosterState } from './contracts';

export function BoosterHud({
  doubleJumpCount,
  shieldCount,
}: Pick<BoosterState, 'doubleJumpCount' | 'shieldCount'>) {
  return (
    <ul className="booster-hud" aria-label="Booster inventory">
      {[
        {
          kind: 'boing',
          Icon: ChevronsUp,
          count: doubleJumpCount,
          label: 'double jump',
        },
        { kind: 'shield', Icon: Shield, count: shieldCount, label: 'shield' },
      ].map(({ kind, Icon, count, label }) => (
        <li
          className={`booster-slot ${kind}-slot`}
          data-ready={count > 0}
          key={kind}
        >
          <Icon aria-hidden="true" />
          {count > 0 && (
            <span className="booster-count" aria-hidden="true">
              {count}
            </span>
          )}
          <span className="sr-only">
            {count === 0
              ? `No ${label}s`
              : `${count} ${label}${count === 1 ? '' : 's'} available`}
          </span>
        </li>
      ))}
    </ul>
  );
}
