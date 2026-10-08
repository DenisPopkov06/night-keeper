import { getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";
import type { SaveData } from "@/systems/SaveSystem";

export async function loadCloudSave(): Promise<Partial<SaveData> | null> {
  if (!isRunningOnPlatform()) return null;

  try {
    const player = await getYsdk().getPlayer();
    return (await player.getData()) as Partial<SaveData>;
  } catch (error) {
    console.error("[PlayerData] loadCloudSave failed", error);
    return null;
  }
}

export async function saveCloudSave(data: SaveData): Promise<void> {
  if (!isRunningOnPlatform()) return;

  try {
    const player = await getYsdk().getPlayer();
    await player.setData({ ...data });
  } catch (error) {
    console.error("[PlayerData] saveCloudSave failed", error);
  }
}
