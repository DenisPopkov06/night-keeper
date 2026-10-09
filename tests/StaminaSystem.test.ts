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
});
