import { getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";

export async function showFullscreenAd(onOpen?: () => void, onClose?: () => void): Promise<void> {
  if (!isRunningOnPlatform()) return;
  const ysdk = getYsdk() as {
    adv: { showFullscreenAdv(opts: { callbacks: Record<string, () => void> }): void };
  };
  ysdk.adv.showFullscreenAdv({
    callbacks: {
      onOpen: () => onOpen?.(),
      onClose: () => onClose?.(),
    },
  });
}

export async function showRewardedVideo(onRewarded: () => void, onClose?: () => void): Promise<void> {
  if (!isRunningOnPlatform()) {
    onRewarded();
    return;
  }
  const ysdk = getYsdk() as {
    adv: { showRewardedVideo(opts: { callbacks: Record<string, () => void> }): void };
  };
  ysdk.adv.showRewardedVideo({
    callbacks: {
      onRewarded: () => onRewarded(),
      onClose: () => onClose?.(),
    },
  });
}
