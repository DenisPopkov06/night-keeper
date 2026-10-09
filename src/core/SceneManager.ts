import * as THREE from "three";
import { ObjectState, type ZoneLayout, type PlacedObject, type Vec3 } from "@/data/types";
import { OBJECTS_CATALOG } from "@/data/objects.catalog";
import { AssetLoader } from "@/core/AssetLoader";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { createAmbientFill, createMoonLight, createSceneFog } from "@/render/Lighting";
import { createPlaceholderGround } from "@/render/MaterialsLib";

const FALLEN_TILT_RADIANS = Math.PI / 2;
const DISPLACED_OFFSET_RADIUS = 1.2;

export interface CollisionCircle {
  x: number;
  z: number;
  radius: number;
}

/** objectId -> состояние -> objectId модели-варианта, которую показать вместо базовой
 *  (разрушенные/наклонённые надгробия по арт-листу дизайнера, см. objects.catalog.ts).
 *  Для комбинаций без варианта (например, DISPLACED у gravestone_slab_a — наклонённого
 *  варианта плиты пока нет) используется запасной геометрический сдвиг/поворот. */
const VARIANT_MODEL_BY_STATE: Partial<Record<string, Partial<Record<ObjectState, string>>>> = {
  gravestone_cross_a: {
    [ObjectState.BROKEN]: "gravestone_cross_broken_a",
    [ObjectState.FALLEN]: "gravestone_cross_broken_a",
    [ObjectState.DISPLACED]: "gravestone_cross_tilted_a",
  },
  gravestone_arch_a: {
    [ObjectState.BROKEN]: "gravestone_arch_broken_a",
    [ObjectState.FALLEN]: "gravestone_arch_broken_a",
    [ObjectState.DISPLACED]: "gravestone_arch_tilted_a",
  },
  gravestone_slab_a: {
    [ObjectState.BROKEN]: "gravestone_slab_broken_a",
    [ObjectState.FALLEN]: "gravestone_slab_broken_a",
  },
};

// Подвесной фонарь (lantern_iron_a): origin — точка подвеса, плафон висит на 0.68м ниже
// (комментарий дизайнера в каталоге); у отдельной модели, в отличие от запечённой в зону,
// нет своего источника света в .glb — добавляем его сами.
const LANTERN_OBJECT_ID = "lantern_iron_a";
const LANTERN_HANG_OFFSET_Y = -0.68;

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

function createLanternLight(): THREE.PointLight {
  const light = new THREE.PointLight(0xffb84d, 10, 8, 1.8);
  light.position.set(0, LANTERN_HANG_OFFSET_Y + 0.12, 0);
  return light;
}

export class SceneManager {
  readonly scene = new THREE.Scene();

  private zoneRoot: THREE.Group | null = null;
  private staticGeometry: THREE.Object3D | null = null;
  private currentZoneId: string | null = null;
  private currentLayout: ZoneLayout | null = null;
  private readonly interactableObjects: THREE.Object3D[] = [];
  private readonly objectsById = new Map<string, THREE.Object3D>();
  /** Исходный objectId из layout.json — в отличие от userData.objectId на самом
   *  инстансе, не меняется при подмене модели на разрушенный/наклонённый вариант. */
  private readonly baseObjectIdByInstance = new Map<string, string>();
  private readonly animationMixers = new Map<THREE.Object3D, THREE.AnimationMixer>();

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
      if (state !== ObjectState.MISSING) this.handleStateChange(instanceId, state);
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
      this.staticGeometry = zoneScene;
    } catch (error) {
      // Контент приходит от дизайнера постепенно — отсутствующая/битая модель зоны
      // не должна ронять весь игровой цикл: оставляем плейсхолдер-землю вместо
      // чёрной пустоты, пока дизайнер не выложит .glb.
      console.warn(`[SceneManager] не удалось загрузить модель зоны "${layout.modelPath}"`, error);
      const placeholder = createPlaceholderGround();
      zoneRoot.add(placeholder);
      this.staticGeometry = placeholder;
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

    if (placed.objectId === LANTERN_OBJECT_ID) instance.add(createLanternLight());

    parent.add(instance);
    this.objectsById.set(placed.instanceId, instance);
    this.baseObjectIdByInstance.set(placed.instanceId, placed.objectId);
    this.startAnimations(instance, gltf.animations);
    if (catalogEntry.interactable) this.interactableObjects.push(instance);
  }

  unloadCurrentZone(): void {
    if (this.zoneRoot) {
      this.scene.remove(this.zoneRoot);
      disposeObject(this.zoneRoot);
    }
    this.zoneRoot = null;
    this.staticGeometry = null;
    this.interactableObjects.length = 0;
    this.objectsById.clear();
    this.baseObjectIdByInstance.clear();
    this.animationMixers.clear();
    this.currentZoneId = null;
    this.currentLayout = null;
  }

  getObjectByInstanceId(instanceId: string): THREE.Object3D | undefined {
    return this.objectsById.get(instanceId);
  }

  /** Исходный objectId из layout.json — в отличие от текущего userData.objectId на
   *  инстансе, не меняется при подмене модели на разрушенный/наклонённый вариант.
   *  Использовать для подписей/текста (HUD и т.п.), а не для коллизий/моделей. */
  getBaseObjectId(instanceId: string): string | undefined {
    return this.baseObjectIdByInstance.get(instanceId);
  }

  /** Исходное место объекта в раскладке зоны (точка привязки у надгробия/вазы). */
  getAnchorTransform(instanceId: string): { position: Vec3; rotationY: number } | null {
    const placed = this.currentLayout?.objects.find((o) => o.instanceId === instanceId);
    return placed ? { position: placed.position, rotationY: placed.rotationY } : null;
  }

  private handleStateChange(instanceId: string, state: ObjectState): void {
    const object = this.objectsById.get(instanceId);
    const baseObjectId = this.baseObjectIdByInstance.get(instanceId);
    if (!object || !baseObjectId) return;

    const variantId = VARIANT_MODEL_BY_STATE[baseObjectId]?.[state];
    const targetModelId = variantId ?? baseObjectId;

    if (targetModelId !== object.userData.objectId) {
      // Модель-вариант (разбитая/наклонённая) уже сама выглядит как нужное состояние —
      // ставится точно на точку привязки, без дополнительного геометрического сдвига.
      void this.setInstanceModel(instanceId, targetModelId);
    } else if (!variantId) {
      // Нужная модель уже показана (обычно базовая); для DISPLACED/FALLEN без
      // предусмотренного варианта — запасной геометрический сдвиг/поворот.
      this.applyFallbackTransform(instanceId, state);
    }
  }

  private async setInstanceModel(instanceId: string, modelObjectId: string): Promise<void> {
    const current = this.objectsById.get(instanceId);
    const anchor = this.getAnchorTransform(instanceId);
    const baseObjectId = this.baseObjectIdByInstance.get(instanceId);
    if (!current || !anchor || !baseObjectId || !this.zoneRoot) return;

    const catalogEntry = OBJECTS_CATALOG[modelObjectId];
    if (!catalogEntry) return;

    let gltf;
    try {
      gltf = await this.assetLoader.loadModel(catalogEntry.modelPath);
    } catch (error) {
      console.warn(`[SceneManager] не удалось загрузить вариант модели "${modelObjectId}"`, error);
      return;
    }

    // Пока модель грузилась, зона могла выгрузиться или инстанс — замениться ещё раз;
    // в обоих случаях этот (устаревший) результат подставлять уже некуда/нечем.
    if (this.objectsById.get(instanceId) !== current) return;

    const interactable = OBJECTS_CATALOG[baseObjectId]?.interactable ?? false;
    const next = gltf.scene.clone(true);
    enableShadows(next);
    next.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    next.rotation.y = THREE.MathUtils.degToRad(anchor.rotationY);
    next.userData.instanceId = instanceId;
    next.userData.objectId = modelObjectId;
    next.userData.interactable = interactable;

    this.zoneRoot.add(next);
    this.objectsById.set(instanceId, next);
    this.startAnimations(next, gltf.animations);

    const interactIndex = this.interactableObjects.indexOf(current);
    if (interactIndex !== -1) {
      if (interactable) this.interactableObjects[interactIndex] = next;
      else this.interactableObjects.splice(interactIndex, 1);
    } else if (interactable) {
      this.interactableObjects.push(next);
    }

    this.zoneRoot.remove(current);
    this.stopAnimations(current);
    disposeObject(current);
  }

  /** Запасной визуал для состояний без готовой модели-варианта: FALLEN — завален
   *  набок у своего места; DISPLACED — сдвинут в сторону от точки привязки;
   *  остальное (в первую очередь NORMAL) — ровно на своём авторском месте. */
  private applyFallbackTransform(instanceId: string, state: ObjectState): void {
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

    object.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    object.rotation.set(0, anchorRotationRad, 0);
  }

  private startAnimations(object: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    if (clips.length === 0) return;
    const mixer = new THREE.AnimationMixer(object);
    for (const clip of clips) mixer.clipAction(clip).play();
    this.animationMixers.set(object, mixer);
  }

  private stopAnimations(object: THREE.Object3D): void {
    this.animationMixers.delete(object);
  }

  /** Тикает AnimationMixer всех заспавненных объектов со своими клипами (например,
   *  взмах крыльев у бабочки) — вызывать каждый кадр из Game.update(). */
  updateAnimations(deltaSec: number): void {
    for (const mixer of this.animationMixers.values()) mixer.update(deltaSec);
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

  /** Статическая геометрия зоны (дерево/фонари/ограда и т.п., запечённые в модель
   *  зоны дизайнером) плюс расставленные объекты с collisionMesh в каталоге (дом,
   *  ворота, забор, скамья — длинные/с проходом, круг им не подходит) — для коллизии
   *  игрока лучом вперёд по курсу движения. */
  getStaticCollisionMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = this.staticGeometry ? [this.staticGeometry] : [];
    for (const object of this.objectsById.values()) {
      const objectId = object.userData.objectId as string | undefined;
      if (objectId && OBJECTS_CATALOG[objectId]?.collisionMesh) meshes.push(object);
    }
    return meshes;
  }

  /** Круги-коллайдеры для расставленных непроходимых объектов (надгробия и т.п.,
   *  у которых в каталоге задан collisionRadius) — считается по их текущей,
   *  а не исходной позиции (DISPLACED/FALLEN/MISSING могут их сдвигать), и по
   *  актуально показанной модели (разбитый вариант может иметь другой радиус). */
  getCollisionCircles(): CollisionCircle[] {
    const circles: CollisionCircle[] = [];
    for (const object of this.objectsById.values()) {
      const objectId = object.userData.objectId as string | undefined;
      const radius = objectId ? OBJECTS_CATALOG[objectId]?.collisionRadius : undefined;
      if (!radius) continue;
      circles.push({ x: object.position.x, z: object.position.z, radius });
    }
    return circles;
  }
}
