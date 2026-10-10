/** Спринт — как заряд фонарика: временный ресурс, тратится при использовании,
 *  медленно восстанавливается в покое. Не бесконечный бег. */
export class StaminaSystem {
  private staminaPercent = 100;
  private sprinting = false;
  // Если запас коснулся нуля, держать Shift бесполезно, пока не восстановится хотя бы
  // до recoveryThresholdPercent — простого "staminaPercent > 0" недостаточно: за один
  // кадр подзаряд поднимает его с 0 до долей процента (уже > 0), спринт тут же снова
  // включается на кадр и опять гасит их в ноль — спринт и ходьба чередуются каждый
  // кадр, в среднем давая скорость, почти не отличимую от спринта, а не честную ходьбу.
  private depleted = false;

  constructor(
    private readonly drainPerSecond = 25,
    // Было 15 — полный запас отрастал обратно меньше чем за 7с, спринт ощущался
    // почти без ограничений. 6/с — полное восстановление ~16-17с.
    private readonly rechargePerSecond = 6,
    private readonly recoveryThresholdPercent = 20,
  ) {}

  /** wantsSprint — зажата ли клавиша спринта. Реально бежит бегом, только если
   *  запас ещё остался и не действует "отдышка" после полного исчерпания. */
  update(deltaSec: number, wantsSprint: boolean): void {
    const canSprint = wantsSprint && !this.depleted && this.staminaPercent > 0;
    if (canSprint) {
      this.sprinting = true;
      this.staminaPercent = Math.max(0, this.staminaPercent - this.drainPerSecond * deltaSec);
      if (this.staminaPercent === 0) this.depleted = true;
    } else {
      this.sprinting = false;
      this.staminaPercent = Math.min(100, this.staminaPercent + this.rechargePerSecond * deltaSec);
      if (this.depleted && this.staminaPercent >= this.recoveryThresholdPercent) this.depleted = false;
    }
  }

  isSprinting(): boolean {
    return this.sprinting;
  }

  getStaminaPercent(): number {
    return this.staminaPercent;
  }
}
