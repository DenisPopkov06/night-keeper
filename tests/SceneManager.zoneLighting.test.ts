import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SceneManager } from "@/core/SceneManager";
import type { AssetLoader } from "@/core/AssetLoader";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { localLightFactorForShift } from "@/render/Lighting";
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

/** Имитирует то, что отдаёт GLTFLoader для зоны с запечённым "лунным" directional
 * light (zone_lib.py build_moon_light) и практическим point light (фонарь/окно). */
function makeZoneSceneWithBakedLights(): { scene: THREE.Group; pointLight: THREE.PointLight } {
  const scene = new THREE.Group();
  const moonLight = new THREE.DirectionalLight(0xffffff, 1.0);
  moonLight.name = "moon_light";
  scene.add(moonLight);

  const pointLight = new THREE.PointLight(0xffb84d, 65, 8, 1.8);
  pointLight.name = "lantern_light_a";
  scene.add(pointLight);

  return { scene, pointLight };
}

function makeLoader(scene: THREE.Group): AssetLoader {
  return { loadModel: () => Promise.resolve({ scene, animations: [] }) } as unknown as AssetLoader;
}

describe("SceneManager: запечённый свет зоны", () => {
  it("убирает дублирующий запечённый DirectionalLight (игра использует свой собственный)", async () => {
    const { scene } = makeZoneSceneWithBakedLights();
    const manager = new SceneManager(makeLoader(scene), new ObjectStateMachine());
    await manager.loadZone(LAYOUT);

    let found = false;
    manager.scene.traverse((node) => {
      if (node instanceof THREE.DirectionalLight && node.name === "moon_light") found = true;
    });
    expect(found).toBe(false);
  });

  it("гасит запечённые точечные светильники (фонарь/окно) по той же рампе, что и ambient/moon", async () => {
    const { scene } = makeZoneSceneWithBakedLights();
    const manager = new SceneManager(makeLoader(scene), new ObjectStateMachine());
    await manager.loadZone(LAYOUT);

    manager.applyShiftDarkness(5);

    let pointLight: THREE.PointLight | null = null;
    manager.scene.traverse((node) => {
      if (node instanceof THREE.PointLight && node.name === "lantern_light_a") pointLight = node;
    });
    expect(pointLight).not.toBeNull();
    expect(pointLight!.intensity).toBeCloseTo(65 * localLightFactorForShift(5), 5);
  });

  it("возвращает к полной яркости на смене 1 (рампа применяется заново, а не накопительно)", async () => {
    const { scene } = makeZoneSceneWithBakedLights();
    const manager = new SceneManager(makeLoader(scene), new ObjectStateMachine());
    await manager.loadZone(LAYOUT);

    manager.applyShiftDarkness(5);
    manager.applyShiftDarkness(1);

    let pointLight: THREE.PointLight | null = null;
    manager.scene.traverse((node) => {
      if (node instanceof THREE.PointLight && node.name === "lantern_light_a") pointLight = node;
    });
    expect(pointLight!.intensity).toBeCloseTo(65, 5);
  });
});
