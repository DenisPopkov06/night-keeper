import { getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";

export async function submitScore(leaderboardName: string, score: number): Promise<void> {
  if (!isRunningOnPlatform()) return;
  const ysdk = getYsdk() as {
    getLeaderboards(): Promise<{ setLeaderboardScore(name: string, score: number): Promise<void> }>;
  };
  const leaderboards = await ysdk.getLeaderboards();
  await leaderboards.setLeaderboardScore(leaderboardName, score);
}
