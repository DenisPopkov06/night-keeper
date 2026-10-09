import * as THREE from "three";
import { ObjectState } from "@/data/types";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ShiftManager } from "@/systems/ShiftManager";
import { SceneManager } from "@/core/SceneManager";

const HIGHLIGHT_EMISSIVE = new THREE.Color(0x3a3a1a);
const HIGHLIGHT_INTENSITY = 0.8;
const DEFAULT_REPAIR_SEC = 2;
const PLACEMENT_RADIUS = 2;
const MAX_INTERACT_DISTANCE = 3.5;
const CARRY_SPEED_MULTIPLIER = 0.7;
const CARRY_OFFSET = new THREE.Vector3(0.25, -0.3, -0.8);

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

  private carriedObject: THREE.Object3D | null = null;
  private carriedInstanceId: string | null = null;

  constructor(
    private readonly camera: THREE.Camera,
    private readonly stateMachine: ObjectStateMachine,
    private readonly shiftManager: ShiftManager,
    private readonly sceneManager: SceneManager,
  ) {}

  /** holdingInteract — зажата ли клавиша взаимодействия (для таймера ремонта BROKEN). */
  update(interactables: THREE.Object3D[], holdingInteract: boolean, deltaSec: number): void {
    // Руки заняты переносимым предметом — наводиться/подсвечивать больше нечего.
    if (this.carriedObject) {
      this.cancelRepair();
      return;
    }

    this.raycaster.setFromCamera(this.centerScreen, this.camera);
    this.raycaster.far = MAX_INTERACT_DISTANCE;
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

  /** Нажатие E: мгновенный ремонт/подбор для большинства состояний, таймер для BROKEN,
   *  взять/положить для MISSING. */
  interact(): void {
    if (this.carriedObject) {
      this.putDownCarried();
      return;
    }

    const instanceId = this.focusedRoot?.userData.instanceId as string | undefined;
    if (!instanceId || this.repairingInstanceId === instanceId) return;

    const state = this.stateMachine.getState(instanceId);
    if (state === ObjectState.NORMAL) return;

    if (state === ObjectState.MISSING) {
      this.pickUp(this.focusedRoot as THREE.Object3D, instanceId);
      return;
    }

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

  /** Текст подсказки под прицелом — что сделает E прямо сейчас (или null, если нечего). */
  getInteractionPrompt(): string | null {
    if (this.carriedObject) return "E — положить";

    const instanceId = this.focusedRoot?.userData.instanceId as string | undefined;
    if (!instanceId) return null;

    if (this.repairingInstanceId === instanceId) return "Удерживайте E…";

    switch (this.stateMachine.getState(instanceId)) {
      case ObjectState.NORMAL:
        return null;
      case ObjectState.MISSING:
        return "E — поднять";
      case ObjectState.BROKEN:
        return "Удерживайте E — починить";
      default:
        return "E — поправить";
    }
  }

  isCarrying(): boolean {
    return this.carriedObject !== null;
  }

  /** Вызывается в конце смены: если игрок что-то нёс в руках, кладёт это обратно
   *  на точку привязки, чтобы предмет не "улетел" в руках в следующую смену
   *  (задача всё равно не считается выполненной — её не было на момент завершения). */
  forceDropCarried(): void {
    if (!this.carriedObject || !this.carriedInstanceId) return;
    const anchor = this.sceneManager.getAnchorTransform(this.carriedInstanceId);
    if (anchor) this.sceneManager.placeCarriedObject(this.carriedObject, anchor.position, anchor.rotationY);
    this.carriedObject = null;
    this.carriedInstanceId = null;
  }

  /** Множитель скорости движения, пока в руках предмет (раздел 2 ТЗ по геймплею). */
  getMoveSpeedMultiplier(): number {
    return this.carriedObject ? CARRY_SPEED_MULTIPLIER : 1;
  }

  /** Объект "крепится перед камерой" — снимается с текущего родителя и становится
   *  ребёнком камеры с фиксированным оффсетом, как держат предмет в руках. */
  private pickUp(object: THREE.Object3D, instanceId: string): void {
    this.clearHighlight();
    this.focusedRoot = null;

    object.removeFromParent();
    object.position.copy(CARRY_OFFSET);
    object.rotation.set(0, 0, 0);
    this.camera.add(object);

    this.carriedObject = object;
    this.carriedInstanceId = instanceId;
  }

  /** Рядом с точкой привязки — ставит предмет на место и завершает задачу;
   *  иначе просто кладёт там, где стоит игрок (не засчитывается). */
  private putDownCarried(): void {
    const object = this.carriedObject;
    const instanceId = this.carriedInstanceId;
    if (!object || !instanceId) return;

    const playerPosition = new THREE.Vector3();
    this.camera.getWorldPosition(playerPosition);

    const anchor = this.sceneManager.getAnchorTransform(instanceId);
    const anchorPosition = anchor
      ? new THREE.Vector3(anchor.position.x, anchor.position.y, anchor.position.z)
      : null;
    const atAnchor = anchorPosition !== null && playerPosition.distanceTo(anchorPosition) <= PLACEMENT_RADIUS;

    if (atAnchor && anchor) {
      this.sceneManager.placeCarriedObject(object, anchor.position, anchor.rotationY);
      this.stateMachine.transition(instanceId, ObjectState.NORMAL);
    } else {
      const groundY = anchor?.position.y ?? playerPosition.y;
      this.sceneManager.placeCarriedObject(
        object,
        { x: playerPosition.x, y: groundY, z: playerPosition.z },
        0,
      );
    }

    this.carriedObject = null;
    this.carriedInstanceId = null;
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
