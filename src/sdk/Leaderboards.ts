import { getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";

export async function submitScore(leaderboardName: string, score: number): Promise<void> {
  if (!isRunningOnPlatform()) return;

  try {
    const leaderboards = await getYsdk().getLeaderboards();
    await leaderboards.setLeaderboardScore(leaderboardName, score);
  } catch (error) {
    console.error(`[Leaderboards] failed to submit score to "${leaderboardName}"`, error);
  }
}
