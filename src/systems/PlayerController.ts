import * as THREE from "three";
import { InputManager } from "@/core/InputManager";
import type { Vec3 } from "@/data/types";

const MOUSE_SENSITIVITY = 0.0025;
// Референсный рост персонажа из раздела 4.1 ТЗ (~1.7м) минус небольшой запас
// до уровня глаз, чтобы камера не торчала выше модели персонажа (когда она появится).
const EYE_HEIGHT = 1.6;

export class PlayerController {
  private readonly moveInput = new THREE.Vector3();
  private readonly yawOnly = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly moveSpeed = 3;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
  ) {
    this.camera.rotation.order = "YXZ";
  }

  /** Ставит камеру в точку спавна зоны на высоте глаз — spawnPoint в ZoneLayout
   *  задаёт позицию на уровне пола, а не камеры. */
  teleportTo(spawnPoint: Vec3): void {
    this.camera.position.set(spawnPoint.x, spawnPoint.y + EYE_HEIGHT, spawnPoint.z);
  }

  update(deltaSec: number): void {
    this.moveInput.set(0, 0, 0);
    if (this.input.isKeyDown("KeyW")) this.moveInput.z -= 1;
    if (this.input.isKeyDown("KeyS")) this.moveInput.z += 1;
    if (this.input.isKeyDown("KeyA")) this.moveInput.x -= 1;
    if (this.input.isKeyDown("KeyD")) this.moveInput.x += 1;

    const virtualMove = this.input.getVirtualMove();
    this.moveInput.x += virtualMove.x;
    this.moveInput.z += virtualMove.y;

    if (this.moveInput.lengthSq() > 0) {
      if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();
      this.yawOnly.y = this.camera.rotation.y;
      this.moveInput.applyEuler(this.yawOnly);
      this.camera.position.addScaledVector(this.moveInput, this.moveSpeed * deltaSec);
    }

    const { x: deltaX, y: deltaY } = this.input.consumeMouseDelta();
    this.camera.rotation.y -= deltaX * MOUSE_SENSITIVITY;
    this.camera.rotation.x -= deltaY * MOUSE_SENSITIVITY;
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.camera.rotation.x,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );

    // TODO: капсульная коллизия со статической геометрией зоны — задача 5.3
  }
}
