import { describe, expect, it } from "vitest";
import { formatTaskLabel } from "@/ui/taskLabels";
import { ObjectState } from "@/data/types";

describe("formatTaskLabel", () => {
  it("formats a known object with correct grammatical gender", () => {
    expect(formatTaskLabel("gravestone_cross_a", ObjectState.DISPLACED)).toBe("Надгробие: сдвинуто");
    expect(formatTaskLabel("vase_clay_01", ObjectState.DISPLACED)).toBe("Ваза: сдвинута");
    expect(formatTaskLabel("vase_clay_01", ObjectState.MISSING)).toBe("Ваза: пропала");
  });

  it("falls back to the raw objectId (neuter grammar) for an unknown catalog entry", () => {
    expect(formatTaskLabel("some_future_prop", ObjectState.FALLEN)).toBe("some_future_prop: упало");
  });
});
