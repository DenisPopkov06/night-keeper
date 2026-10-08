export interface YandexAdCallbacks {
  onOpen?: () => void;
  onClose?: (wasShown?: boolean) => void;
  onError?: (error: unknown) => void;
  onOffline?: () => void;
  onRewarded?: () => void;
}

export interface YandexPlayer {
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}

export interface YandexLeaderboards {
  setLeaderboardScore(leaderboardName: string, score: number): Promise<void>;
}

export interface YSDK {
  adv: {
    showFullscreenAdv(options: { callbacks: YandexAdCallbacks }): void;
    showRewardedVideo(options: { callbacks: YandexAdCallbacks }): void;
  };
  getPlayer(options?: { scopes?: boolean }): Promise<YandexPlayer>;
  getLeaderboards(): Promise<YandexLeaderboards>;
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YSDK> };
  }
}

let ysdk: YSDK | null = null;
let isPlatform = false;

export async function initYandexSDK(): Promise<void> {
  if (typeof window === "undefined" || !window.YaGames) {
    // dev-режим на localhost (или сборка без CDN-скрипта) — площадка недоступна
    isPlatform = false;
    return;
  }

  try {
    ysdk = await window.YaGames.init();
    isPlatform = true;
  } catch (error) {
    console.error("[YandexSDK] init() failed, falling back to dev mode", error);
    ysdk = null;
    isPlatform = false;
  }
}

/** Бросает, если вызвана не на площадке — проверяйте isRunningOnPlatform() перед вызовом. */
export function getYsdk(): YSDK {
  if (!ysdk) {
    throw new Error("[YandexSDK] getYsdk() called without a successful init (not on platform)");
  }
  return ysdk;
}

export function isRunningOnPlatform(): boolean {
  return isPlatform;
}
