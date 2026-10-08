import { describe, expect, it } from "vitest";
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

  it("is complete only once every task is marked done", () => {
    const stateMachine = new ObjectStateMachine();
    const shiftManager = new ShiftManager(stateMachine);
    shiftManager.startShift(makeConfig());

    expect(shiftManager.isShiftComplete()).toBe(false);

    shiftManager.markTaskComplete("grave_014");
    expect(shiftManager.isShiftComplete()).toBe(false);

    shiftManager.markTaskComplete("vase_01");
    expect(shiftManager.isShiftComplete()).toBe(true);
  });
});
