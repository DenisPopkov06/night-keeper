import * as THREE from "three";
import type { Vec3 } from "@/data/types";

export interface HintCandidate {
  instanceId: string;
  position: Vec3;
}

/** Чистая функция без Three.js — какой из кандидатов ближе всего к игроку. */
export function findNearestInstanceId(from: Vec3, candidates: readonly HintCandidate[]): string | null {
  let nearestId: string | null = null;
  let nearestDistSq = Infinity;

  for (const candidate of candidates) {
    const dx = candidate.position.x - from.x;
    const dy = candidate.position.y - from.y;
    const dz = candidate.position.z - from.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestId = candidate.instanceId;
    }
  }

  return nearestId;
}

const MARKER_DURATION_SEC = 6;
const MARKER_HEIGHT_OFFSET = 1.8;

interface ActiveMarker {
  mesh: THREE.Object3D;
  remainingSec: number;
}

/** Временный маркер (светящаяся вращающаяся сфера) над позицией ближайшей невыполненной задачи. */
export class HintSystem {
  private readonly markers: ActiveMarker[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  showHintAt(position: Vec3): void {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a }),
    );
    marker.position.set(position.x, position.y + MARKER_HEIGHT_OFFSET, position.z);

    this.scene.add(marker);
    this.markers.push({ mesh: marker, remainingSec: MARKER_DURATION_SEC });
  }

  update(deltaSec: number): void {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i];
      marker.remainingSec -= deltaSec;
      marker.mesh.rotation.y += deltaSec * 2;

      if (marker.remainingSec <= 0) {
        this.scene.remove(marker.mesh);
        this.markers.splice(i, 1);
      }
    }
  }
}
