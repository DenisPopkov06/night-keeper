import { describe, expect, it, vi } from "vitest";
import { ShiftManager } from "@/systems/ShiftManager";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ObjectState, type ShiftConfig } from "@/data/types";

function makeConfig(): ShiftConfig {
  return {
    shiftIndex: 1,
    zoneId: "old_cemetery",
    flashlightCharge: 100,
    timeLimitSec: 300,
    tasks: [
      { instanceId: "grave_014", state: ObjectState.FALLEN },
      { instanceId: "vase_01", state: ObjectState.MISSING },
    ],
  };
}

describe("ShiftManager", () => {
  it("applies task states on start", () => {
    const stateMachine = new ObjectStateMachine();
    const shiftManager = new ShiftManager(stateMachine);

    shiftManager.startShift(makeConfig());

    expect(stateMachine.getState("grave_014")).toBe(ObjectState.FALLEN);
    expect(stateMachine.getState("vase_01")).toBe(ObjectState.MISSING);
  });

  it("auto-completes a task when its object is fixed back to NORMAL", () => {
    const stateMachine = new ObjectStateMachine();
    const shiftManager = new ShiftManager(stateMachine);
    shiftManager.startShift(makeConfig());

    expect(shiftManager.isShiftComplete()).toBe(false);

    stateMachine.transition("grave_014", ObjectState.NORMAL);
    expect(shiftManager.isShiftComplete()).toBe(false);
    expect(shiftManager.getCompletedCount()).toBe(1);

    stateMachine.transition("vase_01", ObjectState.NORMAL);
    expect(shiftManager.isShiftComplete()).toBe(true);
  });

  it("fires onShiftEnd('all_tasks_done') exactly once when the last task is fixed", () => {
    const stateMachine = new ObjectStateMachine();
    const onShiftEnd = vi.fn();
    const shiftManager = new ShiftManager(stateMachine, onShiftEnd);
    shiftManager.startShift(makeConfig());

    stateMachine.transition("grave_014", ObjectState.NORMAL);
    stateMachine.transition("vase_01", ObjectState.NORMAL);
    stateMachine.transition("vase_01", ObjectState.NORMAL);

    expect(onShiftEnd).toHaveBeenCalledTimes(1);
    expect(onShiftEnd).toHaveBeenCalledWith("all_tasks_done");
  });

  it("fires onShiftEnd('time_out') once the clock reaches zero, and stops reacting after", () => {
    const stateMachine = new ObjectStateMachine();
    const onShiftEnd = vi.fn();
    const shiftManager = new ShiftManager(stateMachine, onShiftEnd);
    shiftManager.startShift(makeConfig());

    shiftManager.update(5);
    expect(onShiftEnd).not.toHaveBeenCalled();

    shiftManager.update(0);
    expect(onShiftEnd).toHaveBeenCalledTimes(1);
    expect(onShiftEnd).toHaveBeenCalledWith("time_out");

    stateMachine.transition("grave_014", ObjectState.NORMAL);
    stateMachine.transition("vase_01", ObjectState.NORMAL);
    expect(onShiftEnd).toHaveBeenCalledTimes(1);
  });
});
