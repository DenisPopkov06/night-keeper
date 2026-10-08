import { getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";
import type { SaveData } from "@/systems/SaveSystem";

export async function loadCloudSave(): Promise<Partial<SaveData> | null> {
  if (!isRunningOnPlatform()) return null;
  const ysdk = getYsdk() as { getPlayer(): Promise<{ getData(): Promise<Partial<SaveData>> }> };
  const player = await ysdk.getPlayer();
  return player.getData();
}

export async function saveCloudSave(data: SaveData): Promise<void> {
  if (!isRunningOnPlatform()) return;
  const ysdk = getYsdk() as {
    getPlayer(): Promise<{ setData(data: SaveData): Promise<void> }>;
  };
  const player = await ysdk.getPlayer();
  await player.setData(data);
}
