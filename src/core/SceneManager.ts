import * as THREE from "three";
import { ObjectState, type ZoneLayout, type PlacedObject, type Vec3 } from "@/data/types";
import { OBJECTS_CATALOG } from "@/data/objects.catalog";
import { AssetLoader } from "@/core/AssetLoader";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import {
  ambientIntensityForShift,
  createAmbientFill,
  createMoonLight,
  createSceneFog,
  moonIntensityForShift,
} from "@/render/Lighting";
import { createPlaceholderGround } from "@/render/MaterialsLib";

const FALLEN_TILT_RADIANS = Math.PI / 2;
const DISPLACED_OFFSET_RADIUS = 1.2;

export interface CollisionCircle {
  x: number;
  z: number;
  radius: number;
  /** Невысокое препятствие — прыжком (см. PlayerController) можно перепрыгнуть через
   *  него; для обычной ходьбы по-прежнему блокирует. */
  vaultable: boolean;
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

/** Для cross/arch/slab FALLEN показывает ту же "расколотую" модель, что и BROKEN
 *  (отдельного визуала "упавшего, но целого" надгrobия пока нет, см. комментарий
 *  выше) — значит, по факту это одно и то же состояние на экране и должно требовать
 *  того же ремонта (удержание E, "почините"), а не мгновенного "поправить" как у
 *  просто сдвинутого (DISPLACED) надгробия. У переносимых предметов (венки) FALLEN
 *  выглядит иначе (запасной наклон, не "расколото") — для них это не относится. */
function fallenLooksBroken(baseObjectId: string): boolean {
  const variants = VARIANT_MODEL_BY_STATE[baseObjectId];
  const fallenVariant = variants?.[ObjectState.FALLEN];
  return fallenVariant !== undefined && fallenVariant === variants?.[ObjectState.BROKEN];
}

// Подвесной фонарь (lantern_iron_a): origin — точка подвеса, плафон висит на 0.68м ниже
// (комментарий дизайнера в каталоге); у отдельной модели, в отличие от запечённой в зону,
// нет своего источника света в .glb — добавляем его сами.
const LANTERN_OBJECT_ID = "lantern_iron_a";
const LANTERN_HANG_OFFSET_Y = -0.68;

// Статическая геометрия зоны — один слитый меш без отдельных PlacedObject, поэтому
// коллизия для этих именованных "крупных" деталей внутри нет считается по кругу,
// построенному из реального bounding box (по имени меша из Blender). Луч здесь не
// годится универсально — например, у скамьи тонкие ножки, луч на любой высоте может
// пройти между ними, хотя по силуэту она сплошная (та же причина, по которой сквозь
// крупный валун можно было пройти: приплюснутая икосфера невысокая, оба уровня луча
// иногда проходят мимо). rocks_a сюда не входит — это один слитый меш рассыпанной
// по всей зоне гальки (несколько кластеров по 1 крупному + 2-3 мелких валуна,
// assets_src/blender/zone_lib.py build_rocks) — единый bounding box для него был бы
// в размер всей зоны. Вместо этого для rocks_* считаем круг отдельно на каждый
// "остров" геометрии (физически не соприкасающиеся валуны не делят вершины, см.
// computeIslandCircles) и оставляем только острова крупнее ROCK_MIN_COLLISION_RADIUS —
// мелкую гальку (r 0.14-0.34) можно спокойно перешагнуть, блокировать её не нужно.
// tree_ намеренно не здесь: ствол дерева и так надёжно ловится лучом (проходит через
// обе высоты), а bounding box дерева считается по всей кроне — круг получился бы
// в разы шире реального ствола и сделал бы непроходимой зону, где физически пройти
// можно (под кроной, в стороне от ствола).
// vaultable: true только для бочек/ящиков — невысокие, прыжком через них разумно
// перескочить (как и у надгробий-инстансов, см. objects.catalog.ts). Фонарный столб,
// скамья и постамент выше/сложнее по силуэту — остаются сплошной стеной и при прыжке.
const STATIC_CIRCLE_NAME_PATTERNS: { pattern: RegExp; vaultable: boolean }[] = [
  { pattern: /^lamp_post_/, vaultable: false },
  { pattern: /^barrels?_/, vaultable: true },
  { pattern: /^crates?_/, vaultable: true },
  { pattern: /^bench_wood/, vaultable: false },
  { pattern: /^pedestal_/, vaultable: false },
];
const ROCK_MESH_NAME_PATTERN = /^rocks_/;
const ROCK_MIN_COLLISION_RADIUS = 0.4;

function computeBoundingCircle(mesh: THREE.Mesh, vaultable: boolean): CollisionCircle {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox?.clone() ?? new THREE.Box3();
  box.applyMatrix4(mesh.matrixWorld);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { x: center.x, z: center.z, radius: Math.max(size.x, size.z) / 2, vaultable };
}

/** Разбивает один слитый меш на несвязные "острова" геометрии (например, отдельные
 *  валуны в rocks_a, нигде физически не соприкасающиеся друг с другом — значит, не
 *  делят вершины) и считает bounding-круг для каждого острова отдельно, в мировых
 *  координатах. Группировка — по квантованной позиции вершины (а не по индексу),
 *  чтобы одинаково работать и с indexed-, и с non-indexed-геометрией из экспортера. */
function computeIslandCircles(mesh: THREE.Mesh, minRadius: number, vaultable: boolean): CollisionCircle[] {
  const position = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const triangleCount = (index ? index.count : position.count) / 3;
  const vertexIndex = (t: number, corner: number): number =>
    index ? index.getX(t * 3 + corner) : t * 3 + corner;
  const keyOf = (i: number): string =>
    `${Math.round(position.getX(i) * 1000)}_${Math.round(position.getY(i) * 1000)}_${Math.round(position.getZ(i) * 1000)}`;

  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  const triangles: [number, number, number][] = [];
  for (let t = 0; t < triangleCount; t++) {
    const triangle: [number, number, number] = [vertexIndex(t, 0), vertexIndex(t, 1), vertexIndex(t, 2)];
    triangles.push(triangle);
    for (const i of triangle) {
      const key = keyOf(i);
      if (!parent.has(key)) parent.set(key, key);
    }
    union(keyOf(triangle[0]), keyOf(triangle[1]));
    union(keyOf(triangle[1]), keyOf(triangle[2]));
  }

  const worldPoint = new THREE.Vector3();
  const boundsByIsland = new Map<string, THREE.Box3>();
  for (const triangle of triangles) {
    for (const i of triangle) {
      const root = find(keyOf(i));
      let box = boundsByIsland.get(root);
      if (!box) {
        box = new THREE.Box3();
        boundsByIsland.set(root, box);
      }
      worldPoint.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(worldPoint);
    }
  }

  const circles: CollisionCircle[] = [];
  for (const box of boundsByIsland.values()) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) / 2;
    if (radius >= minRadius) circles.push({ x: center.x, z: center.z, radius, vaultable });
  }
  return circles;
}

/** "Надгробие"-категория для рандомизации раскладки — непроходимый ремонтируемый
 *  объект (collisionRadius задан), а не переносимый мелкий предмет вроде горшка
 *  (у pickup() он тоже repairable, но без collisionRadius). Выводится из каталога,
 *  а не захардкожен по именам — новый тип надгробия дизайнера подхватится сам. */
function isGravestoneLikeObjectId(objectId: string): boolean {
  const entry = OBJECTS_CATALOG[objectId];
  return !!entry && entry.repairableStates.length > 0 && entry.collisionRadius !== undefined;
}

/** Переносимый мелкий предмет заданий (горшок, венок, цветы) — тоже кандидат на
 *  рандомизацию "где он стоит", но отдельной группой от надгробий (другой габарит). */
function isPickupObjectId(objectId: string): boolean {
  const entry = OBJECTS_CATALOG[objectId];
  return !!entry && entry.interactable && entry.repairableStates.length > 0 && entry.collisionRadius === undefined;
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

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
  /** Какая модель должна стоять на инстансе по ПОСЛЕДНЕМУ состоянию. Обновляется сразу
   *  (до загрузки модели), в отличие от userData.objectId, который отстаёт на время
   *  загрузки: без этого быстрая смена состояний (BROKEN → NORMAL → FALLEN, как в
   *  ShiftManager.startShift) оставляла на экране модель от не последнего состояния —
   *  например, сломанное надгробие в состоянии NORMAL, с которым ничего нельзя сделать. */
  private readonly desiredModelByInstance = new Map<string, string>();
  private readonly animationMixers = new Map<THREE.Object3D, THREE.AnimationMixer>();
  private readonly staticCollisionCircles: CollisionCircle[] = [];
  /** Ссылки нужны, чтобы менять яркость по ходу смен (applyShiftDarkness) —
   *  createAmbientFill()/createMoonLight() добавляются в сцену один раз насовсем,
   *  зона потом грузится/выгружается поверх, без пересоздания света. */
  private readonly ambientLight = createAmbientFill();
  private readonly moonLight = createMoonLight();

  constructor(
    private readonly assetLoader: AssetLoader,
    stateMachine: ObjectStateMachine,
  ) {
    this.scene.add(this.ambientLight, this.moonLight);
    this.scene.fog = createSceneFog();
    this.loadSkyBackground();

    // MISSING сюда не входит — та позиция (spawnPosition) приходит из конкретной
    // задачи смены, а не выводится из одной лишь точки привязки, поэтому её
    // отдельно проставляет Game после ShiftManager.startShift().
    stateMachine.onChange((instanceId, state) => {
      if (state !== ObjectState.MISSING) this.handleStateChange(instanceId, state);
    });
  }

  /** Небо — равноугольная (equirectangular) панорама позади модели зоны. Туман не
   *  затрагивает фон, а купол неба внутри самой модели зоны дизайнер закрасил бы
   *  целиком, поэтому фон задаём отдельно, кодом (по просьбе дизайнера). Текстуру
   *  может ещё не подвезти — как и с моделями, отсутствие файла не должно ронять
   *  игру, просто фон останется чёрным, пока дизайнер не выложит sky_night.jpg. */
  private loadSkyBackground(): void {
    new THREE.TextureLoader().load(
      "textures/sky_night.jpg",
      (sky) => {
        sky.mapping = THREE.EquirectangularReflectionMapping;
        sky.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = sky;
      },
      undefined,
      (error) => console.warn('[SceneManager] не удалось загрузить "textures/sky_night.jpg"', error),
    );
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
      zoneScene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const staticMatch = STATIC_CIRCLE_NAME_PATTERNS.find((p) => p.pattern.test(node.name));
        if (staticMatch) {
          this.staticCollisionCircles.push(computeBoundingCircle(node, staticMatch.vaultable));
        } else if (ROCK_MESH_NAME_PATTERN.test(node.name)) {
          this.staticCollisionCircles.push(...computeIslandCircles(node, ROCK_MIN_COLLISION_RADIUS, true));
        }
      });
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
    this.desiredModelByInstance.set(placed.instanceId, placed.objectId);
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
    this.staticCollisionCircles.length = 0;
    this.interactableObjects.length = 0;
    this.objectsById.clear();
    this.baseObjectIdByInstance.clear();
    this.desiredModelByInstance.clear();
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

  /** См. fallenLooksBroken — нужен InteractionSystem, чтобы решить, какой текст
   *  подсказки и какую механику (мгновенно/удержание) показать для FALLEN. */
  isFallenLikeBroken(instanceId: string): boolean {
    const baseObjectId = this.baseObjectIdByInstance.get(instanceId);
    return baseObjectId !== undefined && fallenLooksBroken(baseObjectId);
  }

  /** Исходное место объекта в раскладке зоны (точка привязки у надгробия/вазы). */
  getAnchorTransform(instanceId: string): { position: Vec3; rotationY: number } | null {
    const placed = this.currentLayout?.objects.find((o) => o.instanceId === instanceId);
    return placed ? { position: placed.position, rotationY: placed.rotationY } : null;
  }

  /** Перемешивает, кто где стоит — отдельно надгробия между собой и переносимые
   *  предметы (горшки и т.п.) между собой (авторские "слоты" дизайнера остаются
   *  теми же самыми местами, без путей/заборов, просто инстансы меняются местами),
   *  чтобы раскладка зоны не была одинаковой каждую смену. Вызывать ДО
   *  getShiftConfig() в начале смены — он сам прочитает уже перемешанный
   *  currentLayout.objects, а обновлённые позиции сразу видны и на сцене. */
  reshufflePlacedObjects(): void {
    if (!this.currentLayout) return;
    this.shuffleGroupPositions(isGravestoneLikeObjectId);
    this.shuffleGroupPositions(isPickupObjectId);
  }

  /** Постепенное затемнение по сменам (ambientIntensityForShift/moonIntensityForShift —
   *  см. Lighting.ts): к 3-4-й смене фонарик уже не опция, а необходимость, чтобы
   *  что-то разглядеть. Вызывать в начале каждой смены. */
  applyShiftDarkness(shiftIndex: number): void {
    this.ambientLight.intensity = ambientIntensityForShift(shiftIndex);
    this.moonLight.intensity = moonIntensityForShift(shiftIndex);
  }

  private shuffleGroupPositions(matches: (objectId: string) => boolean): void {
    if (!this.currentLayout) return;
    const group = this.currentLayout.objects.filter((o) => matches(o.objectId));
    const slots = group.map((o) => ({ position: o.position, rotationY: o.rotationY }));
    shuffleInPlace(slots);

    group.forEach((placed, i) => {
      placed.position = slots[i].position;
      placed.rotationY = slots[i].rotationY;

      const instance = this.objectsById.get(placed.instanceId);
      if (!instance) return;
      instance.position.set(slots[i].position.x, slots[i].position.y, slots[i].position.z);
      instance.rotation.y = THREE.MathUtils.degToRad(slots[i].rotationY);
    });
  }

  private handleStateChange(instanceId: string, state: ObjectState): void {
    const object = this.objectsById.get(instanceId);
    const baseObjectId = this.baseObjectIdByInstance.get(instanceId);
    if (!object || !baseObjectId) return;

    const variantId = VARIANT_MODEL_BY_STATE[baseObjectId]?.[state];
    const targetModelId = variantId ?? baseObjectId;
    // Запоминаем желаемую модель сразу: устаревшие результаты загрузки (setInstanceModel)
    // сверяются с ней и отбрасываются, так что побеждает всегда последнее состояние.
    this.desiredModelByInstance.set(instanceId, targetModelId);

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
    const anchor = this.getAnchorTransform(instanceId);
    const baseObjectId = this.baseObjectIdByInstance.get(instanceId);
    if (!anchor || !baseObjectId || !this.zoneRoot) return;

    const catalogEntry = OBJECTS_CATALOG[modelObjectId];
    if (!catalogEntry) return;

    let gltf;
    try {
      gltf = await this.assetLoader.loadModel(catalogEntry.modelPath);
    } catch (error) {
      console.warn(`[SceneManager] не удалось загрузить вариант модели "${modelObjectId}"`, error);
      return;
    }

    // Пока модель грузилась, могло прийти более новое состояние (нужна уже другая модель)
    // или зона выгрузиться — тогда этот устаревший результат подставлять нельзя. Текущий
    // инстанс берём ПОСЛЕ await, а не до: заменять надо то, что стоит на момент подмены.
    if (this.desiredModelByInstance.get(instanceId) !== modelObjectId) return;
    const current = this.objectsById.get(instanceId);
    if (!current || !this.zoneRoot) return;

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
    const circles: CollisionCircle[] = [...this.staticCollisionCircles];
    for (const object of this.objectsById.values()) {
      const objectId = object.userData.objectId as string | undefined;
      const catalogEntry = objectId ? OBJECTS_CATALOG[objectId] : undefined;
      if (!catalogEntry?.collisionRadius) continue;
      circles.push({
        x: object.position.x,
        z: object.position.z,
        radius: catalogEntry.collisionRadius,
        vaultable: catalogEntry.vaultable ?? false,
      });
    }
    return circles;
  }
}
