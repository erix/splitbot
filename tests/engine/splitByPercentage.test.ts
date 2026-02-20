import { describe, it, expect } from "vitest";
import { splitByPercentage } from "../../src/engine/index.js";

describe("splitByPercentage", () => {
  it("should split 1000 cents by valid percentages", () => {
    const result = splitByPercentage(1000, {
      user1: 50,
      user2: 30,
      user3: 20,
    });

    const total = Object.values(result).reduce((sum, val) => sum + val, 0);
    expect(total).toBe(1000); // Must sum exactly to total

    // Should be approximately correct (within rounding)
    expect(result.user1).toBeCloseTo(500, 0);
    expect(result.user2).toBeCloseTo(300, 0);
    expect(result.user3).toBeCloseTo(200, 0);
  });

  it("should throw error when percentages don't sum to 100", () => {
    expect(() =>
      splitByPercentage(1000, {
        user1: 50,
        user2: 30,
      })
    ).toThrow("Percentages must sum to 100");
  });

  it("should throw error when percentages exceed 100", () => {
    expect(() =>
      splitByPercentage(1000, {
        user1: 60,
        user2: 50,
      })
    ).toThrow("Percentages must sum to 100");
  });

  it("should handle rounding and give remainder to last person", () => {
    const result = splitByPercentage(100, {
      user1: 33.33,
      user2: 33.33,
      user3: 33.34,
    });

    const total = Object.values(result).reduce((sum, val) => sum + val, 0);
    expect(total).toBe(100); // Must be exact
  });

  it("should handle uneven percentages with rounding", () => {
    const result = splitByPercentage(1000, {
      alice: 25,
      bob: 25,
      charlie: 25,
      dave: 25,
    });

    expect(result.alice).toBe(250);
    expect(result.bob).toBe(250);
    expect(result.charlie).toBe(250);
    expect(result.dave).toBe(250);
  });

  it("should ensure total is exact even with complex percentages", () => {
    const result = splitByPercentage(999, {
      a: 33,
      b: 33,
      c: 34,
    });

    const total = Object.values(result).reduce((sum, val) => sum + val, 0);
    expect(total).toBe(999);
  });
});
