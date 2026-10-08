export class Clock {
  private lastTimeMs = 0;
  private shiftRemainingSec = 0;
  private paused = false;

  /** На паузе всегда возвращает 0 — все update(deltaSec) по цепочке замирают,
   *  а не только таймер смены. lastTimeMs всё равно продвигается, иначе после
   *  снятия паузы случился бы один огромный скачок deltaSec. */
  tick(nowMs: number): number {
    if (this.lastTimeMs === 0) this.lastTimeMs = nowMs;
    const rawDeltaSec = (nowMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = nowMs;

    if (this.paused) return 0;

    this.shiftRemainingSec = Math.max(0, this.shiftRemainingSec - rawDeltaSec);
    return rawDeltaSec;
  }

  startShiftTimer(timeLimitSec: number): void {
    this.shiftRemainingSec = timeLimitSec;
  }

  getShiftRemainingSec(): number {
    return this.shiftRemainingSec;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }
}
