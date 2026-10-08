const STORAGE_KEY = "night-keeper:save";

export interface SaveData {
  shiftIndex: number;
  score: number;
  soundVolume: number;
}

const DEFAULT_SAVE: SaveData = { shiftIndex: 1, score: 0, soundVolume: 1 };

export class SaveSystem {
  load(): SaveData {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    try {
      return { ...DEFAULT_SAVE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SAVE };
    }
  }

  save(data: SaveData): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // TODO: синхронизация с PlayerData.ts (облако) — задача 5.4
  }
}
