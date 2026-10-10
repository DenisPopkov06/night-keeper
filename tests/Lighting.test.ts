import { describe, expect, it } from "vitest";
import { LIGHTING_CONFIG, ambientIntensityForShift, moonIntensityForShift } from "@/render/Lighting";

describe("ambientIntensityForShift", () => {
  it("matches the base config on shift 1 (no darkening yet)", () => {
    expect(ambientIntensityForShift(1)).toBeCloseTo(LIGHTING_CONFIG.ambientIntensity, 5);
  });

  it("decreases monotonically through shifts 1-4", () => {
    const values = [1, 2, 3, 4].map(ambientIntensityForShift);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
  });

  it("stays at the shift-4 floor for any later shift", () => {
    expect(ambientIntensityForShift(10)).toBeCloseTo(ambientIntensityForShift(4), 5);
  });

  it("never goes below the floor (pure dimming, not pitch black)", () => {
    expect(ambientIntensityForShift(50)).toBeGreaterThan(0);
  });
});

describe("moonIntensityForShift", () => {
  it("matches the base config on shift 1", () => {
    expect(moonIntensityForShift(1)).toBeCloseTo(LIGHTING_CONFIG.moonIntensity, 5);
  });

  it("decreases monotonically through shifts 1-4 and then holds", () => {
    const values = [1, 2, 3, 4].map(moonIntensityForShift);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
    expect(moonIntensityForShift(7)).toBeCloseTo(moonIntensityForShift(4), 5);
  });
});
