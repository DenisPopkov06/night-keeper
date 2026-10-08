import * as THREE from "three";
import { ObjectState } from "@/data/types";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ShiftManager } from "@/systems/ShiftManager";

const HIGHLIGHT_EMISSIVE = new THREE.Color(0x3a3a1a);
const HIGHLIGHT_INTENSITY = 0.8;
const DEFAULT_REPAIR_SEC = 2;

interface HighlightEntry {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
}

export class InteractionSystem {
  private readonly raycaster = new THREE.Raycaster();
  private readonly centerScreen = new THREE.Vector2(0, 0);
  private focusedRoot: THREE.Object3D | null = null;
  private readonly highlighted: HighlightEntry[] = [];

  private repairingInstanceId: string | null = null;
  private repairRemainingSec = 0;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly stateMachine: ObjectStateMachine,
    private readonly shiftManager: ShiftManager,
  ) {}

  /** holdingInteract — зажата ли клавиша взаимодействия (для таймера ремонта BROKEN). */
  update(interactables: THREE.Object3D[], holdingInteract: boolean, deltaSec: number): void {
    this.raycaster.setFromCamera(this.centerScreen, this.camera);
    const [hit] = this.raycaster.intersectObjects(interactables, true);
    const nextRoot = hit ? this.findInteractableRoot(hit.object, interactables) : null;

    if (nextRoot !== this.focusedRoot) {
      this.clearHighlight();
      this.focusedRoot = nextRoot;
      if (this.focusedRoot) this.applyHighlight(this.focusedRoot);
      this.cancelRepair();
    }

    if (this.repairingInstanceId) {
      const stillFocused = this.focusedRoot?.userData.instanceId === this.repairingInstanceId;
      if (holdingInteract && stillFocused) {
        this.repairRemainingSec -= deltaSec;
        if (this.repairRemainingSec <= 0) this.completeRepair();
      } else {
        this.cancelRepair();
      }
    }
  }

  /** Нажатие E: мгновенный ремонт для большинства состояний, таймер для BROKEN. */
  interact(): void {
    const instanceId = this.focusedRoot?.userData.instanceId as string | undefined;
    if (!instanceId || this.repairingInstanceId === instanceId) return;

    const state = this.stateMachine.getState(instanceId);
    // MISSING чинится не кликом по надгробию, а поиском и возвратом пропавшего
    // предмета — это отдельная механика подбора предметов, вне этой системы.
    if (state === ObjectState.NORMAL || state === ObjectState.MISSING) return;

    if (state === ObjectState.BROKEN) {
      const task = this.shiftManager.getCurrentConfig()?.tasks.find((t) => t.instanceId === instanceId);
      this.repairingInstanceId = instanceId;
      this.repairRemainingSec = task?.repairTimeSec ?? DEFAULT_REPAIR_SEC;
      return;
    }

    this.stateMachine.transition(instanceId, ObjectState.NORMAL);
  }

  getFocused(): THREE.Object3D | null {
    return this.focusedRoot;
  }

  getRepairProgress(): { instanceId: string; remainingSec: number } | null {
    if (!this.repairingInstanceId) return null;
    return { instanceId: this.repairingInstanceId, remainingSec: this.repairRemainingSec };
  }

  private completeRepair(): void {
    if (this.repairingInstanceId) {
      this.stateMachine.transition(this.repairingInstanceId, ObjectState.NORMAL);
    }
    this.cancelRepair();
  }

  private cancelRepair(): void {
    this.repairingInstanceId = null;
    this.repairRemainingSec = 0;
  }

  private findInteractableRoot(
    hitObject: THREE.Object3D,
    interactables: THREE.Object3D[],
  ): THREE.Object3D | null {
    const roots = new Set(interactables);
    let current: THREE.Object3D | null = hitObject;
    while (current) {
      if (roots.has(current)) return current;
      current = current.parent;
    }
    return null;
  }

  /** Материалы клонируются только на время подсветки — модели шарят материалы
   *  между инстансами (SceneManager клонирует только граф объектов), поэтому
   *  мутировать оригинал означало бы подсветить сразу все однотипные пропсы. */
  private applyHighlight(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;

      this.highlighted.push({ mesh: node, originalMaterial: node.material });

      const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
      const highlightedMaterials = sourceMaterials.map((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) return material;
        const clone = material.clone();
        clone.emissive = HIGHLIGHT_EMISSIVE.clone();
        clone.emissiveIntensity = HIGHLIGHT_INTENSITY;
        return clone;
      });
      node.material = Array.isArray(node.material) ? highlightedMaterials : highlightedMaterials[0];
    });
  }

  private clearHighlight(): void {
    for (const entry of this.highlighted) {
      entry.mesh.material = entry.originalMaterial;
    }
    this.highlighted.length = 0;
  }
}
