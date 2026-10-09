import { describe, expect, it, vi } from "vitest";
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

const BASE = "gravestone_cross_a";
const BROKEN = "gravestone_cross_broken_a";
const SLOW_MS = 40;

const LAYOUT: ZoneLayout = {
  zoneId: "test",
  modelPath: "models/zone_test.glb",
  spawnPoint: { x: 0, y: 0, z: 0 },
  objects: [
    {
      instanceId: "g1",
      objectId: BASE,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      defaultState: ObjectState.NORMAL,
    },
  ],
};

/** Загрузчик-пустышка: модели — пустые группы, а пути из slowPaths грузятся дольше остальных. */
function makeLoader(slowPaths: string[]): AssetLoader {
  return {
    loadModel: (path: string) =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ scene: new THREE.Group(), animations: [] }), slowPaths.includes(path) ? SLOW_MS : 0),
      ),
  } as unknown as AssetLoader;
}

async function setup(slowPaths: string[]) {
  const stateMachine = new ObjectStateMachine();
  const manager = new SceneManager(makeLoader(slowPaths), stateMachine);
  await manager.loadZone(LAYOUT);
  return { stateMachine, manager };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, SLOW_MS * 3));
const shownModel = (manager: SceneManager) => manager.getObjectByInstanceId("g1")?.userData.objectId;

describe("SceneManager: подмена модели надгробия при смене состояния", () => {
  it("показывает модель последнего состояния, если BROKEN сразу сменился на NORMAL", async () => {
    const { stateMachine, manager } = await setup([`models/props/${BROKEN}.glb`]);

    stateMachine.transition("g1", ObjectState.BROKEN);
    stateMachine.transition("g1", ObjectState.NORMAL);
    await settle();

    expect(shownModel(manager)).toBe(BASE);
  });

  it("показывает сломанную модель, если NORMAL сразу сменился на FALLEN (у креста FALLEN — тоже «сломан»)", async () => {
    const { stateMachine, manager } = await setup([`models/props/${BASE}.glb`]);

    stateMachine.transition("g1", ObjectState.BROKEN);
    await settle();
    expect(shownModel(manager)).toBe(BROKEN);

    stateMachine.transition("g1", ObjectState.NORMAL);
    stateMachine.transition("g1", ObjectState.FALLEN);
    await settle();

    expect(shownModel(manager)).toBe(BROKEN);
  });

  it("при цепочке BROKEN → NORMAL → BROKEN остаётся сломанная модель", async () => {
    const { stateMachine, manager } = await setup([`models/props/${BROKEN}.glb`]);

    stateMachine.transition("g1", ObjectState.BROKEN);
    stateMachine.transition("g1", ObjectState.NORMAL);
    stateMachine.transition("g1", ObjectState.BROKEN);
    await settle();

    expect(shownModel(manager)).toBe(BROKEN);
  });

  it("без гонки работает как раньше: сломать, подождать, починить", async () => {
    const { stateMachine, manager } = await setup([]);

    stateMachine.transition("g1", ObjectState.BROKEN);
    await settle();
    expect(shownModel(manager)).toBe(BROKEN);

    stateMachine.transition("g1", ObjectState.NORMAL);
    await settle();
    expect(shownModel(manager)).toBe(BASE);
  });

  it("надгробие остаётся в списке интерактивных после любой подмены", async () => {
    const { stateMachine, manager } = await setup([`models/props/${BROKEN}.glb`]);

    stateMachine.transition("g1", ObjectState.BROKEN);
    stateMachine.transition("g1", ObjectState.NORMAL);
    stateMachine.transition("g1", ObjectState.FALLEN);
    await settle();

    const shown = manager.getObjectByInstanceId("g1");
    expect(shown).toBeDefined();
    expect(manager.getInteractableObjects()).toContain(shown);
    expect(manager.getInteractableObjects()).toHaveLength(1);
  });
});
