/** Спринт — как заряд фонарика: временный ресурс, тратится при использовании,
 *  медленно восстанавливается в покое. Не бесконечный бег. */
export class StaminaSystem {
  private staminaPercent = 100;
  private sprinting = false;

  constructor(
    private readonly drainPerSecond = 25,
    private readonly rechargePerSecond = 15,
  ) {}

  /** wantsSprint — зажата ли клавиша спринта. Реально бежит бегом, только если
   *  запас ещё остался; при 0 заставляет сперва отпустить клавишу и восстановиться
   *  хотя бы немного (без этого на самой границе 0% спринт дёргался бы каждый кадр). */
  update(deltaSec: number, wantsSprint: boolean): void {
    if (wantsSprint && this.staminaPercent > 0) {
      this.sprinting = true;
      this.staminaPercent = Math.max(0, this.staminaPercent - this.drainPerSecond * deltaSec);
    } else {
      this.sprinting = false;
      this.staminaPercent = Math.min(100, this.staminaPercent + this.rechargePerSecond * deltaSec);
    }
  }

  isSprinting(): boolean {
    return this.sprinting;
  }

  getStaminaPercent(): number {
    return this.staminaPercent;
  }
}
