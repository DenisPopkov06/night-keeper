import * as THREE from "three";
import { InputManager } from "@/core/InputManager";

const MOUSE_SENSITIVITY = 0.0025;

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
