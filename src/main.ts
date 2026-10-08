import { initYandexSDK, getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";
import { Game } from "@/core/Game";

async function bootstrap(): Promise<void> {
  await initYandexSDK();

  const canvas = document.getElementById("app-canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#app-canvas not found");

  const game = new Game(canvas);
  game.start();

  // LoadingAPI.ready() обязателен сразу после первого отрендеренного кадра,
  // иначе прогресс-бар загрузки площадки не скрывается. requestAnimationFrame
  // внутри requestAnimationFrame гарантирует, что кадр из game.start() уже
  // не просто поставлен в очередь, а реально отрисован браузером.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (isRunningOnPlatform()) getYsdk().features.LoadingAPI?.ready();
    });
  });
}

void bootstrap();
