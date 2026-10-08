import "@/ui/styles/index.css";
import { initYandexSDK, getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";
import { Game } from "@/core/Game";
import oldCemeteryLayout from "@/levels/zone_old_cemetery/layout.json";
import type { ZoneLayout } from "@/data/types";

async function bootstrap(): Promise<void> {
  await initYandexSDK();

  const canvas = document.getElementById("app-canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#app-canvas not found");
  const uiRoot = document.getElementById("ui-root");
  if (!uiRoot) throw new Error("#ui-root not found");

  const game = new Game(canvas, uiRoot);
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

  // Пока это единственная зона с контентом — выбор стартовой зоны (меню/прогресс)
  // не входит в текущий объём задач.
  // JSON даёт defaultState как string — приводим к ZoneLayout (корректность значений проверяет tests/layouts.test.ts).
  await game.beginFirstShift(oldCemeteryLayout as ZoneLayout);
}

void bootstrap();
