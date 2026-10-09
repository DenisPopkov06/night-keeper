import { describe, expect, it } from "vitest";
import { distanceTo, findNearestInstanceId, relativeBearing } from "@/systems/HintSystem";

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

describe("relativeBearing", () => {
  const origin = { x: 0, y: 0, z: 0 };

  it("is ~0 when the target is straight ahead (default yaw, -Z forward)", () => {
    expect(relativeBearing(origin, { x: 0, y: 0, z: -5 }, 0)).toBeCloseTo(0, 5);
  });

  it("is ~+PI/2 when the target is to the right at yaw 0", () => {
    expect(relativeBearing(origin, { x: 5, y: 0, z: 0 }, 0)).toBeCloseTo(Math.PI / 2, 5);
  });

  it("is ~-PI/2 when the target is to the left at yaw 0", () => {
    expect(relativeBearing(origin, { x: -5, y: 0, z: 0 }, 0)).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("is ~PI (or -PI) when the target is directly behind", () => {
    const bearing = relativeBearing(origin, { x: 0, y: 0, z: 5 }, 0);
    expect(Math.abs(bearing)).toBeCloseTo(Math.PI, 5);
  });

  it("stays ~0 for a target ahead after turning to face it (yaw follows the turn)", () => {
    // Цель правее игрока в мировых координатах (+X); довернувшись к ней лицом
    // (yaw -PI/2 — у камеры increasing yaw значит поворот налево, см. PlayerController),
    // она должна оказаться прямо по курсу.
    const bearing = relativeBearing(origin, { x: 5, y: 0, z: 0 }, -Math.PI / 2);
    expect(bearing).toBeCloseTo(0, 5);
  });
});

describe("distanceTo", () => {
  it("measures straight-line distance in the XZ plane, ignoring height", () => {
    expect(distanceTo({ x: 0, y: 0, z: 0 }, { x: 3, y: 100, z: 4 })).toBeCloseTo(5, 5);
  });
});
