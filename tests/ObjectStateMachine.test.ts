import { describe, expect, it } from "vitest";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ObjectState } from "@/data/types";

describe("ObjectStateMachine", () => {
  it("returns NORMAL for an object with no state set", () => {
    const machine = new ObjectStateMachine();
    expect(machine.getState("grave_014")).toBe(ObjectState.NORMAL);
  });

  it("transitions state and notifies listeners", () => {
    const machine = new ObjectStateMachine();
    const events: Array<[string, ObjectState]> = [];
    machine.onChange((instanceId, state) => events.push([instanceId, state]));

    machine.transition("grave_014", ObjectState.FALLEN);

    expect(machine.getState("grave_014")).toBe(ObjectState.FALLEN);
    expect(events).toEqual([["grave_014", ObjectState.FALLEN]]);
  });
});
