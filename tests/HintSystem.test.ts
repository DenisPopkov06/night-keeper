import { describe, expect, it } from "vitest";
import { findNearestInstanceId } from "@/systems/HintSystem";

describe("findNearestInstanceId", () => {
  it("returns null when there are no candidates", () => {
    expect(findNearestInstanceId({ x: 0, y: 0, z: 0 }, [])).toBeNull();
  });

  it("picks the closest candidate by straight-line distance", () => {
    const result = findNearestInstanceId(
      { x: 0, y: 0, z: 0 },
      [
        { instanceId: "far", position: { x: 10, y: 0, z: 0 } },
        { instanceId: "near", position: { x: 1, y: 0, z: 0 } },
        { instanceId: "medium", position: { x: 5, y: 0, z: 0 } },
      ],
    );

    expect(result).toBe("near");
  });
});
