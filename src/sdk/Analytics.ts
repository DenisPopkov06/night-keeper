import { getYsdk, isRunningOnPlatform } from "@/sdk/YandexSDK";

export type AnalyticsEvent =
  | { name: "shift_start"; shiftIndex: number }
  | { name: "shift_end"; shiftIndex: number; reason: "time_out" | "all_tasks_done" }
  | { name: "hint_used"; shiftIndex: number };

/**
 * ysdk.features.GameplayAPI размечает начало/конец игровой сессии для площадки
 * (сигнал состояния, а не произвольное именованное событие с payload) — поэтому
 * только shift_start/shift_end маппятся на start()/stop(). Остальные события
 * (и всё в dev-режиме) пока уходят только в консоль — SDK v2 на момент написания
 * не даёт документированного API для кастомных именованных событий.
 */
export function trackEvent(event: AnalyticsEvent): void {
  console.warn("[Analytics]", event);

  if (!isRunningOnPlatform()) return;

  const gameplayApi = getYsdk().features.GameplayAPI;
  if (!gameplayApi) return;

  if (event.name === "shift_start") gameplayApi.start();
  if (event.name === "shift_end") gameplayApi.stop();
}
