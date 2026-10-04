export interface GameRecord {
  stars: number;
  playedAt: string;
  /** Earned in the field (game opened from a QR code). Sticky once set. */
  field?: boolean;
}

export interface SaveData {
  version: 1;
  games: Record<string, GameRecord>;
}

type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'bk.save.v1';

/** Progress in localStorage. Any storage failure is swallowed and the data lives on in memory. */
export class Save {
  private readonly storage: SaveStorage | null;
  private data: SaveData;

  /** `null` keeps everything in memory; omitted uses localStorage when it is reachable. */
  constructor(storage: SaveStorage | null = defaultStorage()) {
    this.storage = storage;
    this.data = this.read();
  }

  load(): SaveData {
    return this.data;
  }

  record(gameId: string, stars: number, field?: boolean): SaveData {
    const prev = this.data.games[gameId];
    const rec: GameRecord = { stars: Math.max(prev?.stars ?? 0, stars), playedAt: new Date().toISOString() };
    if (field || prev?.field) rec.field = true;
    this.data = { version: 1, games: { ...this.data.games, [gameId]: rec } };
    this.write();
    return this.data;
  }

  private read(): SaveData {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(KEY) ?? 'null');
      if (isSaveData(parsed)) return parsed;
    } catch {
      // unreadable storage or corrupt JSON: start fresh
    }
    return { version: 1, games: {} };
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // private mode / quota / kiosk lockdown: keep playing from memory
    }
  }
}

function isSaveData(v: unknown): v is SaveData {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Partial<SaveData>;
  return d.version === 1 && typeof d.games === 'object' && d.games !== null;
}

function defaultStorage(): SaveStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
