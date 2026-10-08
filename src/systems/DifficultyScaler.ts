import type { ShiftConfig } from "@/data/types";

/**
 * shiftIndex -> ShiftConfig. Реальная кривая сложности — задача 5.3.
 */
export function getShiftConfig(shiftIndex: number, zoneId: string): ShiftConfig {
  return {
    shiftIndex,
    zoneId,
    flashlightCharge: 100,
    timeLimitSec: 300,
    tasks: [],
  };
}
