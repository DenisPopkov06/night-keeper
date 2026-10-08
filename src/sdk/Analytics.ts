export type AnalyticsEvent =
  | { name: "shift_start"; shiftIndex: number }
  | { name: "shift_end"; shiftIndex: number; reason: "time_out" | "all_tasks_done" }
  | { name: "hint_used"; shiftIndex: number };

export function trackEvent(event: AnalyticsEvent): void {
  // TODO: отправка через ysdk.features.GameplayAPI — задача 5.4
  console.warn("[Analytics]", event);
}
