export interface Route {
  /** Place id from `#gra=<place-id>`, or null (unknown or absent: show the hub). */
  game: string | null;
  kiosk: boolean;
}

export function parseRoute(hash: string, search: string, knownPlaces: string[]): Route {
  const place = new URLSearchParams(hash.replace(/^#/, '')).get('gra');
  return {
    game: place !== null && knownPlaces.includes(place) ? place : null,
    kiosk: new URLSearchParams(search).get('kiosk') === '1',
  };
}
