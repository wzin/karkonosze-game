import type { Scene, SceneContext } from '../core/Scene';

export interface GameEntry {
  id: 'glass' | 'turnips' | 'mine' | 'herbs';
  /** Place id from content/pl.json; `#gra=<placeId>` opens the game directly. */
  placeId: string;
  load: () => Promise<{ default: new (ctx: SceneContext) => Scene }>;
}

export const GAMES: GameEntry[] = [
  { id: 'glass', placeId: 'szklarska', load: () => import('./glass/GlassScene') },
  { id: 'turnips', placeId: 'sniezka', load: () => import('./turnips/TurnipsScene') },
  { id: 'mine', placeId: 'kowary', load: () => import('./mine/MineScene') },
  { id: 'herbs', placeId: 'karpacz', load: () => import('./herbs/HerbsScene') },
];
