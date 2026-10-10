import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SceneManager } from "@/core/SceneManager";
import type { AssetLoader } from "@/core/AssetLoader";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import type { ZoneLayout } from "@/data/types";

// В node-окружении нет DOM — небу в конструкторе SceneManager нечем грузить текстуру.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return { ...actual, TextureLoader: class { load(): void {} } };
});

const LAYOUT: ZoneLayout = {
  zoneId: "test",
  modelPath: "models/zone_test.glb",
  spawnPoint: { x: 0, y: 0, z: 0 },
  objects: [],
};

/** Меш "fence_wood_01" с двумя отдельными островками геометрии (имитация ограды, у
 *  которой часть жерди "выпала" художником, см. zone_lib.py build_fence) — вершины
 *  только у x=-5..-4.9 и x=4.9..5, пустая середина. Раньше это ловилось лучом и могло
 *  промахнуться мимо пустоты; collisionRect должен по-прежнему перекрыть всю середину,
 *  т.к. считается по bounding box меша целиком, а не по его видимой детализации. */
function makeFenceMeshWithGap(): THREE.Mesh {
  const positions = new Float32Array([
    -5, 0, 0, -4.9, 0, 0, -5, 1, 0,
    4.9, 0, 0, 5, 0, 0, 5, 1, 0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = "fence_wood_01";
  return mesh;
}

function makeLoader(scene: THREE.Group): AssetLoader {
  return { loadModel: () => Promise.resolve({ scene, animations: [] }) } as unknown as AssetLoader;
}

describe("SceneManager: коллизия ограды", () => {
  it("rect по ограде перекрывает весь bounding box меша, без зазора посередине", async () => {
    const scene = new THREE.Group();
    scene.add(makeFenceMeshWithGap());
    const manager = new SceneManager(makeLoader(scene), new ObjectStateMachine());

    await manager.loadZone(LAYOUT);
    const [rect] = manager.getCollisionRects();

    expect(rect).toBeDefined();
    expect(rect.minX).toBeCloseTo(-5);
    expect(rect.maxX).toBeCloseTo(5);
    // Середина (x=0) — там, где в меше физически нет геометрии вообще — должна быть
    // внутри собранного прямоугольника, а не в зазоре между двумя островками.
    expect(0).toBeGreaterThanOrEqual(rect.minX);
    expect(0).toBeLessThanOrEqual(rect.maxX);
  });

  it("ограда исключена из лучевой проверки (иначе дублирует rect и может снова поймать зазор)", async () => {
    const scene = new THREE.Group();
    scene.add(makeFenceMeshWithGap());
    const manager = new SceneManager(makeLoader(scene), new ObjectStateMachine());

    await manager.loadZone(LAYOUT);

    // loadZone клонирует переданную сцену (zoneGltf.scene.clone(true)) — ищем клон
    // по имени среди того, что реально участвует в лучевой проверке движения.
    const [staticGeometry] = manager.getStaticCollisionMeshes();
    let clonedFence: THREE.Object3D | undefined;
    staticGeometry.traverse((node) => {
      if (node.name === "fence_wood_01") clonedFence = node;
    });

    expect(clonedFence).toBeDefined();
    expect(manager.getRaycastExcludedMeshes().has(clonedFence!)).toBe(true);
  });

  it("при выгрузке зоны прямоугольники ограды сбрасываются", async () => {
    const scene = new THREE.Group();
    scene.add(makeFenceMeshWithGap());
    const manager = new SceneManager(makeLoader(scene), new ObjectStateMachine());

    await manager.loadZone(LAYOUT);
    expect(manager.getCollisionRects().length).toBeGreaterThan(0);

    manager.unloadCurrentZone();
    expect(manager.getCollisionRects().length).toBe(0);
  });
});
