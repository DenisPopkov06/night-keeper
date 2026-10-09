import * as THREE from "three";

export class FlashlightSystem {
  readonly light: THREE.SpotLight;
  private readonly target = new THREE.Object3D();
  private chargePercent = 100;
  private on = false;

  constructor(
    private readonly drainPerSecond = 2,
    private readonly rechargePerSecond = 1,
  ) {
    this.light = new THREE.SpotLight(0xfff2cc, 80, 25, Math.PI / 7, 0.4);
    this.light.decay = 1.2;
    this.light.visible = false;
    this.target.position.set(0, 0, -1);
    this.light.target = this.target;

    this.light.castShadow = true;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.5;
    this.light.shadow.camera.far = 25;
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

  /** Включён — расходует заряд; выключен — медленно восстанавливает (раздел 8 ТЗ:
   *  "можно либо экономить... либо искать батарейки" — подзаряд не отменяет смысл
   *  экономии, т.к. вдвое медленнее расхода). */
  update(deltaSec: number): void {
    if (this.on) {
      this.chargePercent = Math.max(0, this.chargePercent - this.drainPerSecond * deltaSec);
      if (this.chargePercent === 0) {
        this.on = false;
        this.light.visible = false;
      }
    } else {
      this.chargePercent = Math.min(100, this.chargePercent + this.rechargePerSecond * deltaSec);
    }
  }

  getChargePercent(): number {
    return this.chargePercent;
  }

  isOn(): boolean {
    return this.on;
  }
}
