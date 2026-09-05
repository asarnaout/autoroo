import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoosterHud } from '../app/game/BoosterHud';

describe('booster inventory HUD', () => {
  it.each([
    { doubleJumpCount: 0, shieldCount: 0, badges: [] },
    { doubleJumpCount: 3, shieldCount: 2, badges: ['3', '2'] },
    { doubleJumpCount: 0, shieldCount: 1, badges: ['1'] },
    { doubleJumpCount: 12, shieldCount: 0, badges: ['12'] },
  ])(
    'shows only nonzero counts for inventory $doubleJumpCount / $shieldCount',
    ({ badges, ...counts }) => {
      const html = renderToStaticMarkup(createElement(BoosterHud, counts));
      const displayed = [
        ...html.matchAll(/class="booster-count"[^>]*>(\d+)</g),
      ].map((match) => match[1]);
      expect(displayed).toEqual(badges);
      expect([...html.matchAll(/data-ready="true"/g)]).toHaveLength(
        badges.length,
      );
      expect([...html.matchAll(/<li /g)]).toHaveLength(2);
      expect(html).toContain(
        counts.doubleJumpCount === 0
          ? 'No double jumps'
          : `${counts.doubleJumpCount} double jump`,
      );
      expect(html).toContain(
        counts.shieldCount === 0
          ? 'No shields'
          : `${counts.shieldCount} shield`,
      );
    },
  );
});
