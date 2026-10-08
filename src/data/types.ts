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
}
