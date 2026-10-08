import * as THREE from "three";

export class InteractionSystem {
  private readonly raycaster = new THREE.Raycaster();
  private focused: THREE.Object3D | null = null;

  constructor(private readonly camera: THREE.Camera) {}

  update(interactables: THREE.Object3D[]): void {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const [hit] = this.raycaster.intersectObjects(interactables, true);
    this.focused = hit?.object ?? null;
    // TODO: подсветка (outline/emissive) this.focused — задача 5.3
  }

  interact(): void {
    if (!this.focused) return;
    // TODO: обработка клика/E с учётом текущего ObjectState — задача 5.3
  }

  getFocused(): THREE.Object3D | null {
    return this.focused;
  }
}
