import { ObjectState, type PlacedObject, type ShiftConfig, type ShiftTask } from "@/data/types";

const REPAIRABLE_STATES = [
  ObjectState.DISPLACED,
  ObjectState.FALLEN,
  ObjectState.MISSING,
  ObjectState.BROKEN,
  ObjectState.ANOMALY,
];

const MIN_TIME_LIMIT_SEC = 120;
const MIN_FLASHLIGHT_CHARGE = 40;

function pickRandom<T>(items: readonly T[], count: number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

/**
 * shiftIndex -> ShiftConfig. Время и заряд фонарика падают по мере роста shiftIndex
 * (до пола). `candidates` — объекты зоны, из которых можно набрать задания смены;
 * пока у зон нет расставленных объектов (наполняет дизайнер), tasks будет пустым.
 */
export function getShiftConfig(
  shiftIndex: number,
  zoneId: string,
  candidates: readonly PlacedObject[] = [],
): ShiftConfig {
  const taskCount = Math.min(candidates.length, 2 + Math.floor(shiftIndex / 2));
  const tasks: ShiftTask[] = pickRandom(candidates, taskCount).map((placed) => ({
    instanceId: placed.instanceId,
    state: REPAIRABLE_STATES[Math.floor(Math.random() * REPAIRABLE_STATES.length)],
  }));

  return {
    shiftIndex,
    zoneId,
    flashlightCharge: Math.max(MIN_FLASHLIGHT_CHARGE, 100 - shiftIndex * 4),
    timeLimitSec: Math.max(MIN_TIME_LIMIT_SEC, 300 - shiftIndex * 10),
    tasks,
  };
}
