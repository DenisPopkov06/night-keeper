export class Clock {
  private lastTimeMs = 0;
  private deltaSec = 0;
  private shiftRemainingSec = 0;
  private paused = false;

  tick(nowMs: number): number {
    if (this.lastTimeMs === 0) this.lastTimeMs = nowMs;
    this.deltaSec = (nowMs - this.lastTimeMs) / 1000;
    this.lastTimeMs = nowMs;

    if (!this.paused) {
      this.shiftRemainingSec = Math.max(0, this.shiftRemainingSec - this.deltaSec);
    }
    return this.deltaSec;
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
}
