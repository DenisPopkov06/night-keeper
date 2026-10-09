import * as THREE from "three";
import { ObjectState, type ZoneLayout, type PlacedObject, type Vec3 } from "@/data/types";
import { OBJECTS_CATALOG } from "@/data/objects.catalog";
import { AssetLoader } from "@/core/AssetLoader";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { createAmbientFill, createMoonLight, createSceneFog } from "@/render/Lighting";
import { createPlaceholderGround } from "@/render/MaterialsLib";

const FALLEN_TILT_RADIANS = Math.PI / 2;
const DISPLACED_OFFSET_RADIUS = 1.2;

function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

export class SceneManager {
  readonly scene = new THREE.Scene();

  private zoneRoot: THREE.Group | null = null;
  private currentZoneId: string | null = null;
  private currentLayout: ZoneLayout | null = null;
  private readonly interactableObjects: THREE.Object3D[] = [];
  private readonly objectsById = new Map<string, THREE.Object3D>();

  constructor(
    private readonly assetLoader: AssetLoader,
    stateMachine: ObjectStateMachine,
  ) {
    this.scene.add(createAmbientFill(), createMoonLight());
    this.scene.fog = createSceneFog();

    // MISSING сюда не входит — та позиция (spawnPosition) приходит из конкретной
    // задачи смены, а не выводится из одной лишь точки привязки, поэтому её
    // отдельно проставляет Game после ShiftManager.startShift().
    stateMachine.onChange((instanceId, state) => {
      if (state !== ObjectState.MISSING) this.applyStateVisual(instanceId, state);
    });
  }

  async loadZone(layout: ZoneLayout): Promise<void> {
    this.unloadCurrentZone();

    const zoneRoot = new THREE.Group();
    zoneRoot.name = `zone:${layout.zoneId}`;

    try {
      const zoneGltf = await this.assetLoader.loadModel(layout.modelPath);
      const zoneScene = zoneGltf.scene.clone(true);
      enableShadows(zoneScene);
      zoneRoot.add(zoneScene);
    } catch (error) {
      // Контент приходит от дизайнера постепенно — отсутствующая/битая модель зоны
      // не должна ронять весь игровой цикл: оставляем плейсхолдер-землю вместо
      // чёрной пустоты, пока дизайнер не выложит .glb.
      console.warn(`[SceneManager] не удалось загрузить модель зоны "${layout.modelPath}"`, error);
      zoneRoot.add(createPlaceholderGround());
    }

    await Promise.all(
      layout.objects.map((placed) => this.spawnPlacedObject(placed, zoneRoot)),
    );

    this.scene.add(zoneRoot);
    this.zoneRoot = zoneRoot;
    this.currentZoneId = layout.zoneId;
    this.currentLayout = layout;
  }

  private async spawnPlacedObject(placed: PlacedObject, parent: THREE.Group): Promise<void> {
    const catalogEntry = OBJECTS_CATALOG[placed.objectId];
    if (!catalogEntry) {
      console.warn(`[SceneManager] objectId "${placed.objectId}" отсутствует в OBJECTS_CATALOG`);
      return;
    }

    let gltf;
    try {
      gltf = await this.assetLoader.loadModel(catalogEntry.modelPath);
    } catch (error) {
      console.warn(`[SceneManager] не удалось загрузить модель объекта "${placed.objectId}"`, error);
      return;
    }

    const instance = gltf.scene.clone(true);
    enableShadows(instance);
    instance.position.set(placed.position.x, placed.position.y, placed.position.z);
    instance.rotation.y = THREE.MathUtils.degToRad(placed.rotationY);
    instance.userData.instanceId = placed.instanceId;
    instance.userData.objectId = placed.objectId;
    instance.userData.interactable = catalogEntry.interactable;

    parent.add(instance);
    this.objectsById.set(placed.instanceId, instance);
    if (catalogEntry.interactable) this.interactableObjects.push(instance);
  }

  unloadCurrentZone(): void {
    if (this.zoneRoot) {
      this.scene.remove(this.zoneRoot);
      disposeObject(this.zoneRoot);
    }
    this.zoneRoot = null;
    this.interactableObjects.length = 0;
    this.objectsById.clear();
    this.currentZoneId = null;
    this.currentLayout = null;
  }

  getObjectByInstanceId(instanceId: string): THREE.Object3D | undefined {
    return this.objectsById.get(instanceId);
  }

  /** Исходное место объекта в раскладке зоны (точка привязки у надгробия/вазы). */
  getAnchorTransform(instanceId: string): { position: Vec3; rotationY: number } | null {
    const placed = this.currentLayout?.objects.find((o) => o.instanceId === instanceId);
    return placed ? { position: placed.position, rotationY: placed.rotationY } : null;
  }

  /** Видимое представление состояния объекта — иначе FALLEN/DISPLACED меняют только
   *  логику (ObjectStateMachine), а на сцене надгробие как ни в чём не бывало стоит
   *  ровно. FALLEN — завален набок у своего места; DISPLACED — сдвинут в сторону от
   *  точки привязки; любое другое (прежде всего NORMAL) — ровно на своём месте. */
  private applyStateVisual(instanceId: string, state: ObjectState): void {
    const object = this.objectsById.get(instanceId);
    const anchor = this.getAnchorTransform(instanceId);
    if (!object || !anchor) return;

    const anchorRotationRad = THREE.MathUtils.degToRad(anchor.rotationY);

    if (state === ObjectState.FALLEN) {
      object.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
      object.rotation.set(0, anchorRotationRad, 0);
      object.rotateZ(Math.random() < 0.5 ? FALLEN_TILT_RADIANS : -FALLEN_TILT_RADIANS);
      return;
    }

    if (state === ObjectState.DISPLACED) {
      const angle = Math.random() * Math.PI * 2;
      object.position.set(
        anchor.position.x + Math.cos(angle) * DISPLACED_OFFSET_RADIUS,
        anchor.position.y,
        anchor.position.z + Math.sin(angle) * DISPLACED_OFFSET_RADIUS,
      );
      object.rotation.set(0, anchorRotationRad, 0);
      return;
    }

    // NORMAL (а также BROKEN/ANOMALY — те видимо отличаются текстурой/моделью,
    // не трансформом) — объект ровно на своём авторском месте.
    object.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    object.rotation.set(0, anchorRotationRad, 0);
  }

  /** Телепортирует уже заспавненный инстанс на новую позицию без смены родителя —
   *  используется, чтобы "уронить в траву" пропавший предмет в начале смены (MISSING). */
  relocateInstance(instanceId: string, position: Vec3): void {
    this.objectsById.get(instanceId)?.position.set(position.x, position.y, position.z);
  }

  /** Возвращает предмет, который игрок нёс в руках, обратно в сцену зоны
   *  (а не в scene напрямую — иначе он пережил бы выгрузку зоны и протёк бы в неё следующую). */
  placeCarriedObject(object: THREE.Object3D, position: Vec3, rotationY: number): void {
    this.zoneRoot?.add(object);
    object.position.set(position.x, position.y, position.z);
    object.rotation.set(0, THREE.MathUtils.degToRad(rotationY), 0);
  }

  getCurrentZoneId(): string | null {
    return this.currentZoneId;
  }

  getCurrentLayout(): ZoneLayout | null {
    return this.currentLayout;
  }

  getInteractableObjects(): THREE.Object3D[] {
    return this.interactableObjects;
  }
}
