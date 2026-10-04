import { pick, shuffle } from '../../core/Rng';

export type PlantId =
  | 'arnika'
  | 'goryczka'
  | 'dziewieciesil'
  | 'podbial'
  | 'pierwiosnek'
  | 'prawoslaz'
  | 'piolun'
  | 'mieta'
  | 'muchomor'
  | 'pokrzywa';

export const HERBS: PlantId[] = ['arnika', 'goryczka', 'dziewieciesil', 'podbial', 'pierwiosnek', 'prawoslaz', 'piolun', 'mieta'];
export const DECOYS: PlantId[] = ['muchomor', 'pokrzywa'];

export interface Recipe {
  id: 'kaszel' | 'stluczenia' | 'zoladek';
  herbs: PlantId[];
}

export const RECIPES: Recipe[] = [
  { id: 'kaszel', herbs: ['podbial', 'pierwiosnek', 'prawoslaz'] },
  { id: 'stluczenia', herbs: ['arnika', 'dziewieciesil'] },
  { id: 'zoladek', herbs: ['goryczka', 'piolun', 'mieta'] },
];

/** One plant entering the path: `t` seconds after the round starts, on one of 3 lanes (y 700/800/900). */
export interface Spawn {
  t: number;
  plant: PlantId;
  lane: 0 | 1 | 2;
}

const FIRST_SPAWN = 0.4;
const GAP_MIN = 1.6;
const GAP_SPAN = 0.8;
const OTHER_SHARE = 0.3;
const DECOY_SHARE = 0.2;
/** No decoys before this many seconds: the first plants teach what to tap. */
const DECOY_FREE = 2;
const LANES = [0, 1, 2] as const;

type Kind = 'recipe' | 'other' | 'decoy';

/**
 * A plant every 1.6–2.4 s. About 30 % are herbs from outside the recipe and 20 % decoys; the rest
 * come from the recipe, every recipe herb once before any comes a second time and each at least
 * twice. Lanes never repeat twice in a row. Rounds too short for two of each recipe herb get extra
 * slots past `seconds` and fewer others and decoys, so the recipe can always be gathered.
 */
export function spawnPlan(rng: () => number, recipe: Recipe, seconds = 40): Spawn[] {
  const minRecipe = recipe.herbs.length * 2;
  const times: number[] = [];
  for (let t = FIRST_SPAWN; t < seconds || times.length < minRecipe; t += GAP_MIN + rng() * GAP_SPAN) times.push(t);

  const n = times.length;
  let decoys = Math.round(n * DECOY_SHARE);
  let others = Math.round(n * OTHER_SHARE);
  const short = Math.max(0, minRecipe - (n - decoys - others));
  const fromOthers = Math.min(short, others);
  others -= fromOthers;
  decoys -= short - fromOthers;
  const kinds = shuffle<Kind>(rng, [
    ...Array<Kind>(n - decoys - others).fill('recipe'),
    ...Array<Kind>(others).fill('other'),
    ...Array<Kind>(decoys).fill('decoy'),
  ]);
  keepDecoysLate(kinds, times);

  const extra = Array.from({ length: n - decoys - others - minRecipe }, () => pick(rng, recipe.herbs));
  const recipeQueue = [...shuffle(rng, recipe.herbs), ...shuffle(rng, recipe.herbs), ...extra];
  const otherHerbs = HERBS.filter((h) => !recipe.herbs.includes(h));

  let lane: Spawn['lane'] | null = null;
  return times.map((t, i) => {
    const kind = kinds[i];
    const plant =
      kind === 'recipe' ? (recipeQueue.shift() as PlantId) : pick(rng, kind === 'decoy' ? DECOYS : otherHerbs);
    lane = pick(rng, LANES.filter((l) => l !== lane));
    return { t, plant, lane };
  });
}

/** Swaps every decoy in the decoy-free opening with the first non-decoy slot after it. */
function keepDecoysLate(kinds: Kind[], times: number[]): void {
  for (let i = 0; i < kinds.length && times[i] < DECOY_FREE; i++) {
    if (kinds[i] !== 'decoy') continue;
    const j = kinds.findIndex((k, idx) => k !== 'decoy' && times[idx] >= DECOY_FREE);
    if (j === -1) kinds[i] = 'other';
    else [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
}

export type PickResult = 'needed' | 'duplicate' | 'wrong' | 'decoy';

/** What a tap on `plant` means, given the basket so far (recipe herbs only). */
export function pickResult(basket: PlantId[], plant: PlantId, recipe: Recipe): PickResult {
  if (DECOYS.includes(plant)) return 'decoy';
  if (!recipe.herbs.includes(plant)) return 'wrong';
  return basket.includes(plant) ? 'duplicate' : 'needed';
}

export function basketComplete(basket: PlantId[], recipe: Recipe): boolean {
  return recipe.herbs.every((h) => basket.includes(h));
}

/** needed / (needed + wrong + decoy); duplicates do not count; 1 when nothing counted was picked. */
export function purity(picks: PickResult[]): number {
  const needed = picks.filter((p) => p === 'needed').length;
  const bad = picks.filter((p) => p === 'wrong' || p === 'decoy').length;
  return needed + bad === 0 ? 1 : needed / (needed + bad);
}

const FULL_TURNS = 4;

/** Grinding progress after the pestle swept `angleDeltaRad` (either way round): 4 full turns → 1. */
export function grindProgress(angleDeltaRad: number, current: number): number {
  return Math.min(1, current + Math.abs(angleDeltaRad) / (2 * Math.PI * FULL_TURNS));
}

/** Grinding at most this long (seconds) can still earn 3 stars. */
export const GRIND_FAST = 8;

export function starsFor(purity: number, grindSeconds: number): 1 | 2 | 3 {
  if (purity >= 0.9 && grindSeconds <= GRIND_FAST) return 3;
  if (purity >= 0.6) return 2;
  return 1;
}

export type Verdict = 'missing' | 'wrong' | 'slow' | 'perfect';

/** The main reason a remedy lost stars, for the line under them: missing herbs, wrong picks, slow grinding. */
export function verdict(basket: PlantId[], picks: PickResult[], recipe: Recipe, grindSeconds: number): Verdict {
  if (!basketComplete(basket, recipe)) return 'missing';
  if (picks.some((p) => p === 'wrong' || p === 'decoy')) return 'wrong';
  return grindSeconds > GRIND_FAST ? 'slow' : 'perfect';
}
