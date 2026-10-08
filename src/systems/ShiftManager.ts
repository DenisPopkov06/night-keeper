import { ObjectState, type ShiftConfig } from "@/data/types";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";

export type ShiftEndReason = "time_out" | "all_tasks_done";

export class ShiftManager {
  private currentConfig: ShiftConfig | null = null;
  private readonly completedTaskIds = new Set<string>();
  private ended = false;

  constructor(
    private readonly stateMachine: ObjectStateMachine,
    private readonly onShiftEnd: (reason: ShiftEndReason) => void = () => {},
  ) {
    this.stateMachine.onChange((instanceId, state) => this.handleStateChange(instanceId, state));
  }

  startShift(config: ShiftConfig): void {
    this.currentConfig = config;
    this.completedTaskIds.clear();
    this.ended = false;
    for (const task of config.tasks) {
      this.stateMachine.transition(task.instanceId, task.state);
    }
  }

  /** Вызывать каждый кадр с Clock.getShiftRemainingSec(). */
  update(remainingSec: number): void {
    if (this.ended || !this.currentConfig) return;
    if (remainingSec <= 0) this.endShift("time_out");
  }

  isShiftComplete(): boolean {
    if (!this.currentConfig) return false;
    return this.currentConfig.tasks.every((task) => this.completedTaskIds.has(task.instanceId));
  }

  getCurrentConfig(): ShiftConfig | null {
    return this.currentConfig;
  }

  getCompletedCount(): number {
    return this.completedTaskIds.size;
  }

  private handleStateChange(instanceId: string, state: ObjectState): void {
    if (this.ended || !this.currentConfig) return;
    if (state !== ObjectState.NORMAL) return;

    const isTrackedTask = this.currentConfig.tasks.some((task) => task.instanceId === instanceId);
    if (!isTrackedTask || this.completedTaskIds.has(instanceId)) return;

    this.completedTaskIds.add(instanceId);
    if (this.isShiftComplete()) this.endShift("all_tasks_done");
  }

  private endShift(reason: ShiftEndReason): void {
    this.ended = true;
    this.onShiftEnd(reason);
  }
}
