import { loadCloudSave, saveCloudSave } from "@/sdk/PlayerData";

const STORAGE_KEY = "night-keeper:save";

export interface SaveData {
  shiftIndex: number;
  score: number;
  soundVolume: number;
}

const DEFAULT_SAVE: SaveData = { shiftIndex: 1, score: 0, soundVolume: 1 };

export class SaveSystem {
  private loadLocal(): SaveData {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    try {
      return { ...DEFAULT_SAVE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SAVE };
    }
  }

  /** localStorage отдаётся сразу же, облачное значение (если есть) переопределяет его сверху. */
  async load(): Promise<SaveData> {
    const local = this.loadLocal();
    const cloud = await loadCloudSave();
    return cloud ? { ...local, ...cloud } : local;
  }

  save(data: SaveData): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    void saveCloudSave(data);
  }
}
