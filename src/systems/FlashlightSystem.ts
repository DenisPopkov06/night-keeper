import * as THREE from "three";

export class FlashlightSystem {
  readonly light: THREE.SpotLight;
  private chargePercent = 100;
  private on = false;

  constructor(private readonly drainPerSecond = 2) {
    this.light = new THREE.SpotLight(0xfff2cc, 0, 20, Math.PI / 7, 0.4);
    this.light.visible = false;
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
