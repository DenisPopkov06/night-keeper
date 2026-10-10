import { describe, expect, it } from "vitest";
import { getShiftConfig } from "@/systems/DifficultyScaler";
import { OBJECTS_CATALOG } from "@/data/objects.catalog";
import { ObjectState, type PlacedObject } from "@/data/types";

function makeCandidate(instanceId: string, objectId: string): PlacedObject {
  return {
    instanceId,
    objectId,
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    defaultState: ObjectState.NORMAL,
  };
}

describe("getShiftConfig", () => {
  it("only assigns states the candidate's own catalog entry allows", () => {
    // gravestone_cross_a: DISPLACED/FALLEN/BROKEN only (no MISSING) per objects.catalog.ts
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`grave_${i}`, "gravestone_cross_a"),
    );

    const config = getShiftConfig(10, "old_cemetery", candidates);
    const allowed = OBJECTS_CATALOG.gravestone_cross_a.repairableStates;

    expect(config.tasks.length).toBeGreaterThan(0);
    for (const task of config.tasks) {
      expect(allowed).toContain(task.state);
    }
  });

  it("sets a nearby spawnPosition only for MISSING tasks", () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      makeCandidate(`vase_${i}`, "vase_clay_01"),
    );

    const config = getShiftConfig(10, "old_cemetery", candidates);
    const missingTasks = config.tasks.filter((t) => t.state === ObjectState.MISSING);
    const nonMissingTasks = config.tasks.filter((t) => t.state !== ObjectState.MISSING);

    expect(missingTasks.length + nonMissingTasks.length).toBe(config.tasks.length);
    for (const task of missingTasks) {
      expect(task.spawnPosition).toBeDefined();
    }
    for (const task of nonMissingTasks) {
      expect(task.spawnPosition).toBeUndefined();
    }
  });

  it("returns an empty task list for candidates missing from the catalog", () => {
    const candidates = [makeCandidate("ghost_001", "nonexistent_objectid")];
    const config = getShiftConfig(5, "old_cemetery", candidates);
    expect(config.tasks).toHaveLength(0);
  });

  it("never picks a wreath/flower task before their introducedAtShift (new content gated by shift)", () => {
    // wreath_fresh_a/flowers_daisy_a: introducedAtShift: 5 per objects.catalog.ts
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => makeCandidate(`wreath_${i}`, "wreath_fresh_a")),
      ...Array.from({ length: 10 }, (_, i) => makeCandidate(`flowers_${i}`, "flowers_daisy_a")),
      ...Array.from({ length: 10 }, (_, i) => makeCandidate(`grave_${i}`, "gravestone_cross_a")),
    ];

    for (let shiftIndex = 1; shiftIndex <= 4; shiftIndex++) {
      const config = getShiftConfig(shiftIndex, "old_cemetery", candidates);
      for (const task of config.tasks) {
        expect(task.instanceId.startsWith("wreath_") || task.instanceId.startsWith("flowers_")).toBe(false);
      }
    }
  });

  it("allows wreath/flower tasks once their introducedAtShift is reached", () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => makeCandidate(`wreath_${i}`, "wreath_fresh_a")),
      ...Array.from({ length: 10 }, (_, i) => makeCandidate(`flowers_${i}`, "flowers_daisy_a")),
    ];

    const config = getShiftConfig(6, "old_cemetery", candidates);
    expect(config.tasks.length).toBeGreaterThan(0);
  });
});
