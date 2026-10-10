export enum ObjectState {
  NORMAL = "NORMAL",
  DISPLACED = "DISPLACED",
  FALLEN = "FALLEN",
  MISSING = "MISSING",
  BROKEN = "BROKEN",
  ANOMALY = "ANOMALY",
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlacedObject {
  instanceId: string;
  objectId: string;
  position: Vec3;
  rotationY: number;
  defaultState: ObjectState;
}

export interface ZoneLayout {
  zoneId: string;
  modelPath: string;
  spawnPoint: Vec3;
  objects: PlacedObject[];
}

export interface ShiftTask {
  instanceId: string;
  state: ObjectState;
  repairTimeSec?: number;
  spawnPosition?: Vec3;
}

export interface ShiftConfig {
  shiftIndex: number;
  zoneId: string;
  flashlightCharge: number;
  timeLimitSec: number;
  tasks: ShiftTask[];
}

export interface ObjectCatalogEntry {
  modelPath: string;
  interactable: boolean;
  repairableStates: ObjectState[];
  /** Радиус коллизии (метры) для крупных непроходимых объектов — надгробия,
   *  памятники и т.п. Не задан/отсутствует — объект не блокирует движение
   *  (мелкие переносимые предметы вроде вазы сквозь которые можно пройти вплотную). */
  collisionRadius?: number;
  /** Для длинных/со сложным силуэтом объектов, которым не подходит круг (забор,
   *  дом, ворота, скамья) — коллизия идёт по реальному мешу (тот же луч, что и
   *  для статической геометрии зоны), а не по кругу. */
  collisionMesh?: boolean;
  /** Невысокий объект (надгробие, бочка, ящик, камень) — прыжком можно перепрыгнуть
   *  через него (collisionRadius всё ещё блокирует обычную ходьбу). Не задан/false —
   *  объект достаточно высокий/сложный, чтобы прыжок через него не читался (дерево,
   *  фонарный столб). Не относится к collisionMesh — через забор/дом так не пройти. */
  vaultable?: boolean;
  /** Номер смены, с которой этот objectId впервые может выпасть как задание
   *  (DifficultyScaler.getShiftConfig). Не задан — доступен с первой смены. Для нового
   *  контента дизайнера (венки, цветы), который должен появиться не сразу, а ввестись
   *  позже как усложнение — сам объект стоит в zone с первой смены (это просто декор
   *  кладбища), но как задание не выбирается до этой смены. */
  introducedAtShift?: number;
  /** FALLEN должен лечь плашмя на землю (венок стоит вертикально, "на хвостах ленты",
   *  но упавший венок, в отличие от надгробия, не "топпл" вокруг своей вертикальной
   *  оси — он лежит на земле). Запасной визуал FALLEN в SceneManager.applyFallbackTransform
   *  для таких объектов кладёт их набок поворотом вокруг X (а не вокруг Z, которым
   *  заваливаются и так вертикальные надгробия). Не задан/false — обычный топпл вокруг Z. */
  fallenLiesFlat?: boolean;
}
