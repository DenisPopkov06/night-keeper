import { getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";

export function showFullscreenAd(onOpen?: () => void, onClose?: () => void): void {
  if (!isRunningOnPlatform()) {
    // dev-режим: ведём себя так, будто реклама сразу закрылась — геймплей,
    // который ждёт onClose (пауза/возобновление), тестируется и локально.
    onClose?.();
    return;
  }

  getYsdk().adv.showFullscreenAdv({
    callbacks: {
      onOpen: () => onOpen?.(),
      onClose: () => onClose?.(),
      onError: (error) => {
        console.error("[Ads] fullscreen ad failed", error);
        onClose?.();
      },
    },
  });
}

export function showRewardedVideo(onRewarded: () => void, onClose?: () => void): void {
  if (!isRunningOnPlatform()) {
    onRewarded();
    onClose?.();
    return;
  }

  getYsdk().adv.showRewardedVideo({
    callbacks: {
      onRewarded: () => onRewarded(),
      onClose: () => onClose?.(),
      onError: (error) => console.error("[Ads] rewarded video failed", error),
    },
  });
}
