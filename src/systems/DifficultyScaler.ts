import { type PlacedObject, type ShiftConfig, type ShiftTask, ObjectState } from "@/data/types";
import { OBJECTS_CATALOG } from "@/data/objects.catalog";

const MIN_TIME_LIMIT_SEC = 120;
const MIN_FLASHLIGHT_CHARGE = 40;
const MISSING_SEARCH_RADIUS = 3;
const MISSING_MIN_DISTANCE = 1;

function pickRandom<T>(items: readonly T[], count: number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

/** Точка в траве неподалёку от надгробия/вазы, куда "закатился" пропавший предмет. */
function randomNearbyPosition(anchor: PlacedObject["position"]): PlacedObject["position"] {
  const angle = Math.random() * Math.PI * 2;
  const distance = MISSING_MIN_DISTANCE + Math.random() * (MISSING_SEARCH_RADIUS - MISSING_MIN_DISTANCE);
  return {
    x: anchor.x + Math.cos(angle) * distance,
    y: anchor.y,
    z: anchor.z + Math.sin(angle) * distance,
  };
}

function buildTask(placed: PlacedObject): ShiftTask | null {
  const repairableStates = OBJECTS_CATALOG[placed.objectId]?.repairableStates ?? [];
  if (repairableStates.length === 0) return null;

  const state = repairableStates[Math.floor(Math.random() * repairableStates.length)];
  const task: ShiftTask = { instanceId: placed.instanceId, state };
  if (state === ObjectState.MISSING) task.spawnPosition = randomNearbyPosition(placed.position);
  return task;
}

/** Кандидат доступен заданиям этой смены — у его objectId либо нет introducedAtShift
 *  (контент с самой первой смены), либо текущая смена уже его достигла. Используется,
 *  чтобы новый контент дизайнера (венки, цветы — OBJECTS_CATALOG[...].introducedAtShift)
 *  вводился в задания постепенно, а не был доступен сразу: сам объект при этом всё
 *  равно стоит в zone с первой смены как обычный декор, просто не выбирается в task. */
function isIntroducedByShift(placed: PlacedObject, shiftIndex: number): boolean {
  const introducedAtShift = OBJECTS_CATALOG[placed.objectId]?.introducedAtShift;
  return introducedAtShift === undefined || shiftIndex >= introducedAtShift;
}

/**
 * shiftIndex -> ShiftConfig. Время и заряд фонарика падают по мере роста shiftIndex
 * (до пола). `candidates` — объекты зоны, из которых можно набрать задания смены;
 * пока у зон нет расставленных объектов (наполняет дизайнер), tasks будет пустым.
 * Состояние для каждого кандидата берётся только из его собственного
 * OBJECTS_CATALOG[objectId].repairableStates — иначе, например, надгробию могло
 * бы выпасть MISSING, хотя по каталогу "пропадать" умеют только переносимые вещи.
 */
export function getShiftConfig(
  shiftIndex: number,
  zoneId: string,
  candidates: readonly PlacedObject[] = [],
): ShiftConfig {
  const eligible = candidates.filter((placed) => isIntroducedByShift(placed, shiftIndex));
  const taskCount = Math.min(eligible.length, 2 + Math.floor(shiftIndex / 2));
  const tasks: ShiftTask[] = [];
  for (const placed of pickRandom(eligible, eligible.length)) {
    if (tasks.length >= taskCount) break;
    const task = buildTask(placed);
    if (task) tasks.push(task);
  }

  return {
    shiftIndex,
    zoneId,
    flashlightCharge: Math.max(MIN_FLASHLIGHT_CHARGE, 100 - shiftIndex * 4),
    timeLimitSec: Math.max(MIN_TIME_LIMIT_SEC, 300 - shiftIndex * 10),
    tasks,
  };
}
