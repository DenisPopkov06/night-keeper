declare global {
  interface Window {
    YaGames?: { init(): Promise<unknown> };
  }
}

let ysdk: unknown = null;
let isPlatform = false;

export async function initYandexSDK(): Promise<void> {
  if (typeof window !== "undefined" && window.YaGames) {
    ysdk = await window.YaGames.init();
    isPlatform = true;
  } else {
    // dev-режим на localhost — заглушка, площадка недоступна
    isPlatform = false;
  }
}

export function getYsdk(): unknown {
  return ysdk;
}

export function isRunningOnPlatform(): boolean {
  return isPlatform;
}
