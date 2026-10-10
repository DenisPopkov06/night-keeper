import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PlayerController } from "@/systems/PlayerController";
import type { InputManager } from "@/core/InputManager";
import type { CollisionRect } from "@/core/SceneManager";

/** Жмёт вперёд (KeyW), ничего больше — ровно то, что нужно isBlocked/moveWithCollision. */
function makeForwardInput(): InputManager {
  return {
    isKeyDown: (code: string) => code === "KeyW",
    getVirtualMove: () => ({ x: 0, y: 0 }),
    consumeKeyPress: () => false,
    consumeMouseDelta: () => ({ x: 0, y: 0 }),
  } as unknown as InputManager;
}

const PLAYER_RADIUS = 0.35;

function makeController(startZ: number): { controller: PlayerController; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera();
  const controller = new PlayerController(camera, makeForwardInput());
  controller.teleportTo({ x: 0, y: 0, z: startZ });
  return { controller, camera };
}

/** Симулирует много мелких шагов вперёд (деталями меньше — чем ближе к реальному
 *  кадру 60fps, тем точнее остановка у стены), двигаясь к z=0 вдоль -Z (KeyW). */
function walkForward(
  controller: PlayerController,
  rects: readonly CollisionRect[],
  frames = 400,
  deltaSec = 1 / 60,
): void {
  for (let i = 0; i < frames; i++) {
    controller.update(deltaSec, 1, false, [], [], undefined, rects);
  }
}

describe("PlayerController: коллизия ограды (rect)", () => {
  it("останавливает игрока у прямоугольника по всей его длине — не только по центру", () => {
    // Одна общая ограда x:[-5,5], z:[-0.1,0.1] (как собирает computeBoundingRect
    // для fence_wood_0N) — проверяем приближение по центру и у самого края пролёта.
    const rect: CollisionRect = { minX: -5, maxX: 5, minZ: -0.1, maxZ: 0.1 };

    for (const startX of [0, 4.9]) {
      const camera = new THREE.PerspectiveCamera();
      const controller = new PlayerController(camera, makeForwardInput());
      controller.teleportTo({ x: startX, y: 0, z: 5 });
      walkForward(controller, [rect]);

      // Игрока не пустило внутрь прямоугольника дальше чем на PLAYER_RADIUS от края.
      expect(camera.position.z).toBeGreaterThan(rect.maxZ + PLAYER_RADIUS - 0.05);
    }
  });

  it("без прямоугольников игрок свободно проходит ту же точку (контроль, что именно rect блокирует)", () => {
    const { controller, camera } = makeController(5);
    walkForward(controller, []);

    expect(camera.position.z).toBeLessThan(0);
  });

  it("прыжок не открывает прямоугольник ограды (не vaultable, в отличие от кругов)", () => {
    const rect: CollisionRect = { minX: -5, maxX: 5, minZ: -0.1, maxZ: 0.1 };
    const camera = new THREE.PerspectiveCamera();
    const input: InputManager = {
      isKeyDown: (code: string) => code === "KeyW",
      getVirtualMove: () => ({ x: 0, y: 0 }),
      consumeKeyPress: (code: string) => code === "Space",
      consumeMouseDelta: () => ({ x: 0, y: 0 }),
    } as unknown as InputManager;
    const controller = new PlayerController(camera, input);
    controller.teleportTo({ x: 0, y: 0, z: 1 });

    // Прыжок на пике бы открыл vaultable-круг, но не прямоугольник ограды.
    for (let i = 0; i < 20; i++) controller.update(1 / 60, 1, false, [], [], undefined, [rect]);

    expect(camera.position.z).toBeGreaterThan(rect.maxZ + PLAYER_RADIUS - 0.05);
  });
});
