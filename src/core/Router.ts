export interface Route {
  /** Place id from the hash, or null (unknown or absent: show the hub). */
  game: string | null;
  kiosk: boolean;
}

export interface SceneTarget {
  sceneId: string;
  params: Record<string, string>;
}

/**
 * Reads `#gra=<place-id>` or a bare `#<place-id>` (the form QR links use, since some viewers strip
 * `key=value` hashes) and the `?kiosk=1` flag.
 */
export function parseRoute(hash: string, search: string, knownPlaces: string[]): Route {
  const raw = hash.replace(/^#/, '');
  const place = raw.includes('=') ? new URLSearchParams(raw).get('gra') : raw;
  return {
    game: place !== null && knownPlaces.includes(place) ? place : null,
    kiosk: new URLSearchParams(search).get('kiosk') === '1',
  };
}

/**
 * The first scene for a route: a routed game starts as field play (a QR code on the trail), except
 * on the kiosk (`/?kiosk=1#kowary`), where it is a museum play like any other; anything else opens the hub.
 */
export function routeTarget(route: Route, games: readonly { id: string; placeId: string }[]): SceneTarget {
  const game = games.find((g) => g.placeId === route.game);
  if (!game) return { sceneId: 'hub', params: {} };
  return { sceneId: `game:${game.id}`, params: route.kiosk ? {} : { field: '1' } };
}
