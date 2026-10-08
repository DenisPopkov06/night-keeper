import { initYandexSDK } from "@/sdk/YandexSDK";
import { Game } from "@/core/Game";

async function bootstrap(): Promise<void> {
  await initYandexSDK();

  const canvas = document.getElementById("app-canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#app-canvas not found");

  const game = new Game(canvas);
  game.start();

  // TODO: ysdk.features.LoadingAPI.ready() после первого кадра — задача 5.4/5.6
}

void bootstrap();
