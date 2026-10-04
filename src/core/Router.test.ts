import { it, expect } from 'vitest';
import { parseRoute } from './Router';

const known = ['szklarska', 'kowary'];

it('reads game from hash', () => expect(parseRoute('#gra=kowary', '', known)).toEqual({ game: 'kowary', kiosk: false }));
it('ignores unknown place', () => expect(parseRoute('#gra=xyz', '', known).game).toBeNull());
it('reads kiosk flag', () => expect(parseRoute('', '?kiosk=1', known).kiosk).toBe(true));

it('combines a game hash with the kiosk flag', () =>
  expect(parseRoute('#gra=szklarska', '?kiosk=1', known)).toEqual({ game: 'szklarska', kiosk: true }));
it('treats an empty or foreign hash as the hub', () => {
  expect(parseRoute('', '', known)).toEqual({ game: null, kiosk: false });
  expect(parseRoute('#gra=', '', known).game).toBeNull();
  expect(parseRoute('#kowary', '', known).game).toBeNull();
});
it('needs kiosk=1, not any value', () => expect(parseRoute('', '?kiosk=0', known).kiosk).toBe(false));
