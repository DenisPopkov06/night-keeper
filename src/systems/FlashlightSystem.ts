import * as THREE from "three";

export class FlashlightSystem {
  readonly light: THREE.SpotLight;
  private readonly target = new THREE.Object3D();
  private chargePercent = 100;
  private on = false;

  constructor(private readonly drainPerSecond = 2) {
    this.light = new THREE.SpotLight(0xfff2cc, 15, 20, Math.PI / 7, 0.4);
    this.light.visible = false;
    this.target.position.set(0, 0, -1);
    this.light.target = this.target;

    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.5;
    this.light.shadow.camera.far = 20;
    this.light.shadow.bias = -0.003;
  }

  /** Привязывает фонарик к камере игрока: конус светит туда, куда смотрит камера. */
  attachToCamera(camera: THREE.Camera): void {
    camera.add(this.light);
    camera.add(this.target);
  }

  toggle(): void {
    if (!this.on && this.chargePercent <= 0) return;
    this.on = !this.on;
    this.light.visible = this.on;
  }

  update(deltaSec: number): void {
    if (!this.on) return;
    this.chargePercent = Math.max(0, this.chargePercent - this.drainPerSecond * deltaSec);
    if (this.chargePercent === 0) {
      this.on = false;
      this.light.visible = false;
    }
  }

  getChargePercent(): number {
    return this.chargePercent;
  }

  isOn(): boolean {
    return this.on;
  }
}
