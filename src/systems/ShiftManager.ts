import type { ShiftConfig } from "@/data/types";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";

export class ShiftManager {
  private currentConfig: ShiftConfig | null = null;
  private completedTaskIds = new Set<string>();

  constructor(private readonly stateMachine: ObjectStateMachine) {}

  startShift(config: ShiftConfig): void {
    this.currentConfig = config;
    this.completedTaskIds.clear();
    for (const task of config.tasks) {
      this.stateMachine.transition(task.instanceId, task.state);
    }
  }

  markTaskComplete(instanceId: string): void {
    this.completedTaskIds.add(instanceId);
  }

  isShiftComplete(): boolean {
    if (!this.currentConfig) return false;
    return this.currentConfig.tasks.every((task) => this.completedTaskIds.has(task.instanceId));
  }

  getCurrentConfig(): ShiftConfig | null {
    return this.currentConfig;
  }
}
