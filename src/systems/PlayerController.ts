import * as THREE from "three";
import { InputManager } from "@/core/InputManager";

export class PlayerController {
  private readonly velocity = new THREE.Vector3();
  private readonly moveSpeed = 3;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
  ) {}

  update(deltaSec: number): void {
    this.velocity.set(0, 0, 0);
    if (this.input.isKeyDown("KeyW")) this.velocity.z -= 1;
    if (this.input.isKeyDown("KeyS")) this.velocity.z += 1;
    if (this.input.isKeyDown("KeyA")) this.velocity.x -= 1;
    if (this.input.isKeyDown("KeyD")) this.velocity.x += 1;

    if (this.velocity.lengthSq() > 0) {
      this.velocity.normalize().multiplyScalar(this.moveSpeed * deltaSec);
      this.camera.position.add(this.velocity);
    }

    const { x: yawDelta } = this.input.consumeMouseDelta();
    this.camera.rotation.y -= yawDelta;

    // TODO: капсульная коллизия со статической геометрией зоны — задача 5.3
  }
}
