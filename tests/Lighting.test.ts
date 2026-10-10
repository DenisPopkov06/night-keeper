import { describe, expect, it } from "vitest";
import {
  LIGHTING_CONFIG,
  ambientIntensityForShift,
  localLightFactorForShift,
  moonIntensityForShift,
  skyBackgroundIntensityForShift,
} from "@/render/Lighting";

describe("ambientIntensityForShift", () => {
  it("matches the base config on shift 1 (no darkening yet)", () => {
    expect(ambientIntensityForShift(1)).toBeCloseTo(LIGHTING_CONFIG.ambientIntensity, 5);
  });

  it("decreases monotonically through shifts 1-5", () => {
    const values = [1, 2, 3, 4, 5].map(ambientIntensityForShift);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
  });

  it("stays at the shift-5 floor for any later shift", () => {
    expect(ambientIntensityForShift(20)).toBeCloseTo(ambientIntensityForShift(5), 5);
  });

  it("never goes below the floor (pure dimming, not pitch black)", () => {
    expect(ambientIntensityForShift(50)).toBeGreaterThan(0);
  });

  it("is already noticeably dimmer by shift 3 (regression: must not still look fully lit mid-ramp)", () => {
    expect(ambientIntensityForShift(3)).toBeLessThan(LIGHTING_CONFIG.ambientIntensity * 0.55);
  });
});

describe("moonIntensityForShift", () => {
  it("matches the base config on shift 1", () => {
    expect(moonIntensityForShift(1)).toBeCloseTo(LIGHTING_CONFIG.moonIntensity, 5);
  });

  it("decreases monotonically through shifts 1-5 and then holds", () => {
    const values = [1, 2, 3, 4, 5].map(moonIntensityForShift);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
    expect(moonIntensityForShift(15)).toBeCloseTo(moonIntensityForShift(5), 5);
  });

  it("is already noticeably dimmer by shift 3", () => {
    expect(moonIntensityForShift(3)).toBeLessThan(LIGHTING_CONFIG.moonIntensity * 0.55);
  });
});

describe("localLightFactorForShift (фонарь на столбе, окна/лампа дома)", () => {
  it("is 1 (full brightness) on shift 1", () => {
    expect(localLightFactorForShift(1)).toBeCloseTo(1, 5);
  });

  it("decreases monotonically through shifts 1-5 and then holds at a dim, non-zero floor", () => {
    const values = [1, 2, 3, 4, 5].map(localLightFactorForShift);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
    expect(localLightFactorForShift(5)).toBeGreaterThan(0);
    expect(localLightFactorForShift(5)).toBeLessThan(0.2);
    expect(localLightFactorForShift(20)).toBeCloseTo(localLightFactorForShift(5), 5);
  });
});

describe("skyBackgroundIntensityForShift", () => {
  it("is 1 (full brightness) on shift 1", () => {
    expect(skyBackgroundIntensityForShift(1)).toBeCloseTo(1, 5);
  });

  it("dims monotonically through shifts 1-5 but never to fully black", () => {
    const values = [1, 2, 3, 4, 5].map(skyBackgroundIntensityForShift);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThan(values[i - 1]);
    expect(skyBackgroundIntensityForShift(20)).toBeGreaterThan(0);
    expect(skyBackgroundIntensityForShift(20)).toBeCloseTo(skyBackgroundIntensityForShift(5), 5);
  });
});
