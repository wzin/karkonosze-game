import { it, expect } from 'vitest';
import { parseRoute, routeTarget } from './Router';

const known = ['szklarska', 'kowary', 'staniszow'];
const games = [
  { id: 'glass', placeId: 'szklarska' },
  { id: 'mine', placeId: 'kowary' },
];

it('reads game from hash', () => expect(parseRoute('#gra=kowary', '', known)).toEqual({ game: 'kowary', kiosk: false }));
it('ignores unknown place', () => expect(parseRoute('#gra=xyz', '', known).game).toBeNull());
it('reads kiosk flag', () => expect(parseRoute('', '?kiosk=1', known).kiosk).toBe(true));

it('reads a bare place id as the hash', () => {
  expect(parseRoute('#kowary', '', known)).toEqual({ game: 'kowary', kiosk: false });
  expect(parseRoute('#xyz', '', known).game).toBeNull();
  expect(parseRoute('#staniszow', '', known).game).toBe('staniszow');
});

it('combines a game hash with the kiosk flag', () => {
  expect(parseRoute('#gra=szklarska', '?kiosk=1', known)).toEqual({ game: 'szklarska', kiosk: true });
  expect(parseRoute('#szklarska', '?kiosk=1', known)).toEqual({ game: 'szklarska', kiosk: true });
});
it('treats an empty hash as the hub', () => {
  expect(parseRoute('', '', known)).toEqual({ game: null, kiosk: false });
  expect(parseRoute('#', '', known).game).toBeNull();
  expect(parseRoute('#gra=', '', known).game).toBeNull();
});
it('needs kiosk=1, not any value', () => expect(parseRoute('', '?kiosk=0', known).kiosk).toBe(false));

it('starts a routed game as field play', () =>
  expect(routeTarget({ game: 'kowary', kiosk: false }, games)).toEqual({ sceneId: 'game:mine', params: { field: '1' } }));
it('starts a kiosk deep link (/?kiosk=1#kowary) as a museum play, not a field one', () =>
  expect(routeTarget({ game: 'kowary', kiosk: true }, games)).toEqual({ sceneId: 'game:mine', params: {} }));
it('falls back to the hub, without params, for a place that has no game', () => {
  expect(routeTarget({ game: 'staniszow', kiosk: false }, games)).toEqual({ sceneId: 'hub', params: {} });
  expect(routeTarget({ game: null, kiosk: true }, games)).toEqual({ sceneId: 'hub', params: {} });
});
