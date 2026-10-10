import { describe, expect, it, vi, afterEach } from "vitest";
import * as THREE from "three";
import { SceneManager } from "@/core/SceneManager";
import type { AssetLoader } from "@/core/AssetLoader";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ObjectState, type ZoneLayout } from "@/data/types";

// В node-окружении нет DOM — небу в конструкторе SceneManager нечем грузить текстуру.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return { ...actual, TextureLoader: class { load(): void {} } };
});

function makeLoader(): AssetLoader {
  return { loadModel: () => Promise.resolve({ scene: new THREE.Group(), animations: [] }) } as unknown as AssetLoader;
}

/** Два надгробия далеко друг от друга и венок у ОСНОВАНИЯ первого (как designer-тюнинг
 * "0.14м вперёд по повороту камня, впритык") — ближайшее надгробие к венку однозначно g1. */
const LAYOUT: ZoneLayout = {
  zoneId: "test",
  modelPath: "models/zone_test.glb",
  spawnPoint: { x: 0, y: 0, z: 0 },
  objects: [
    { instanceId: "g1", objectId: "gravestone_cross_a", position: { x: 0, y: 0, z: 0 }, rotationY: 0, defaultState: ObjectState.NORMAL },
    { instanceId: "g2", objectId: "gravestone_slab_a", position: { x: 20, y: 0, z: 20 }, rotationY: 90, defaultState: ObjectState.NORMAL },
    { instanceId: "wreath_001", objectId: "wreath_fresh_a", position: { x: 0, y: 0, z: 0.14 }, rotationY: 0, defaultState: ObjectState.NORMAL },
  ],
};

describe("SceneManager: венок следует за своим надгробием при перемешивании", () => {
  afterEach(() => vi.restoreAllMocks());

  it("после reshufflePlacedObjects венок остаётся в том же оффсете от СВОЕГО (сдвинутого) камня", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // форсирует обмен местами в Fisher-Yates

    const manager = new SceneManager(makeLoader(), new ObjectStateMachine());
    await manager.loadZone(LAYOUT);
    manager.reshufflePlacedObjects();

    const layout = manager.getCurrentLayout();
    const grave = layout?.objects.find((o) => o.instanceId === "g1");
    const wreath = layout?.objects.find((o) => o.instanceId === "wreath_001");
    expect(grave).toBeDefined();
    expect(wreath).toBeDefined();

    // Камень реально переместился (иначе тест ничего не проверяет).
    expect(grave!.position.x !== 0 || grave!.position.z !== 0).toBe(true);

    // Венок остался строго в 0.14м "впритык" от g1 на его НОВОМ месте/повороте,
    // а не на старом (0, 0.14) слоте, где теперь может стоять g2.
    const rad = THREE.MathUtils.degToRad(grave!.rotationY);
    const expectedX = grave!.position.x + 0.14 * -Math.sin(rad);
    const expectedZ = grave!.position.z + 0.14 * Math.cos(rad);
    expect(wreath!.position.x).toBeCloseTo(expectedX, 5);
    expect(wreath!.position.z).toBeCloseTo(expectedZ, 5);
  });

  it("живой THREE-инстанс венка тоже переставлен (не только запись в layout)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const manager = new SceneManager(makeLoader(), new ObjectStateMachine());
    await manager.loadZone(LAYOUT);
    manager.reshufflePlacedObjects();

    const wreathObject = manager.getObjectByInstanceId("wreath_001");
    const layoutWreath = manager.getCurrentLayout()?.objects.find((o) => o.instanceId === "wreath_001");
    expect(wreathObject).toBeDefined();
    expect(wreathObject!.position.x).toBeCloseTo(layoutWreath!.position.x, 5);
    expect(wreathObject!.position.z).toBeCloseTo(layoutWreath!.position.z, 5);
  });
});

describe("SceneManager: упавший венок ложится плашмя, а не заваливается на ребро", () => {
  it("FALLEN у венка (fallenLiesFlat) поворачивает вокруг X, а не вокруг Z, как у надгробия", async () => {
    const stateMachine = new ObjectStateMachine();
    const manager = new SceneManager(makeLoader(), stateMachine);
    await manager.loadZone(LAYOUT);
    stateMachine.transition("wreath_001", ObjectState.FALLEN);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const wreathObject = manager.getObjectByInstanceId("wreath_001");
    expect(wreathObject).toBeDefined();
    const euler = new THREE.Euler().setFromQuaternion(wreathObject!.quaternion, "XYZ");
    // Лежит плашмя: заметный наклон вокруг X (±90°), вокруг Z — почти ничего.
    expect(Math.abs(euler.x)).toBeGreaterThan(1.4); // ~Math.PI/2
    expect(Math.abs(euler.z)).toBeLessThan(0.05);
  });
});
