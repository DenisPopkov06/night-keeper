import { describe, expect, it } from "vitest";
import { StaminaSystem } from "@/systems/StaminaSystem";

describe("StaminaSystem", () => {
  it("drains while sprinting and recharges while not", () => {
    const stamina = new StaminaSystem(25, 15);

    stamina.update(2, true); // 2с спринта: 100 - 50 = 50
    expect(stamina.getStaminaPercent()).toBeCloseTo(50, 5);
    expect(stamina.isSprinting()).toBe(true);

    stamina.update(2, false); // 2с покоя: 50 + 30 = 80
    expect(stamina.getStaminaPercent()).toBeCloseTo(80, 5);
    expect(stamina.isSprinting()).toBe(false);
  });

  it("stops sprinting once stamina hits 0, even if the key is still held", () => {
    const stamina = new StaminaSystem(25, 15);

    stamina.update(10, true); // с запасом – должно упереться в 0, не уйти в минус
    expect(stamina.getStaminaPercent()).toBe(0);

    stamina.update(0.016, true); // запас 0 — спринт не идёт, несмотря на зажатую клавишу
    expect(stamina.isSprinting()).toBe(false);
  });

  it("never recharges above 100", () => {
    const stamina = new StaminaSystem(25, 15);
    stamina.update(100, false);
    expect(stamina.getStaminaPercent()).toBe(100);
  });

  it("does not flicker sprinting frame-to-frame once depleted, even holding the key through small per-frame recharges", () => {
    const stamina = new StaminaSystem(25, 15, 20);
    const dt = 1 / 60;

    stamina.update(10, true); // drain to 0
    expect(stamina.getStaminaPercent()).toBe(0);

    // Each frame recharges by a fraction of a percent (> 0), which on the old
    // "staminaPercent > 0" check alone would immediately re-enable sprint for a
    // single frame, drain it back to 0, and repeat forever — speed barely below
    // sprint. With hysteresis, sprint must stay off until recovery to 20%.
    for (let i = 0; i < 60; i++) {
      stamina.update(dt, true);
      expect(stamina.isSprinting()).toBe(false);
    }
  });

  it("resumes sprinting only after recovering to the threshold, not at the first sign of life", () => {
    const stamina = new StaminaSystem(25, 15, 20);

    stamina.update(10, true); // drain to 0, depleted
    stamina.update(1, false); // 1s rest: 0 + 15 = 15, still under 20% threshold
    expect(stamina.getStaminaPercent()).toBeCloseTo(15, 5);

    stamina.update(0.016, true);
    expect(stamina.isSprinting()).toBe(false); // still below threshold, holding key does nothing

    stamina.update(1, false); // another 1s rest: 15 + 15 = 30, now past 20%
    stamina.update(0.016, true);
    expect(stamina.isSprinting()).toBe(true);
  });
});
