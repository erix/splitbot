import { describe, it, expect } from "vitest";
import { splitByExactAmounts } from "../../src/engine/index.js";

describe("splitByExactAmounts", () => {
  it("should accept valid exact amounts that sum to total", () => {
    const result = splitByExactAmounts(1000, {
      user1: 600,
      user2: 400,
    });

    expect(result).toEqual({
      user1: 600,
      user2: 400,
    });
  });

  it("should throw error when amounts don't sum to total", () => {
    expect(() =>
      splitByExactAmounts(1000, {
        user1: 600,
        user2: 300, // Total is 900, not 1000
      })
    ).toThrow("Exact amounts must sum to total");
  });

  it("should throw error when amounts exceed total", () => {
    expect(() =>
      splitByExactAmounts(1000, {
        user1: 700,
        user2: 500, // Total is 1200, exceeds 1000
      })
    ).toThrow("Exact amounts must sum to total");
  });

  it("should handle single participant with full amount", () => {
    const result = splitByExactAmounts(1000, {
      solo: 1000,
    });

    expect(result).toEqual({
      solo: 1000,
    });
  });

  it("should handle zero amounts", () => {
    const result = splitByExactAmounts(0, {
      user1: 0,
      user2: 0,
    });

    expect(result).toEqual({
      user1: 0,
      user2: 0,
    });
  });

  it("should handle uneven exact splits", () => {
    const result = splitByExactAmounts(1000, {
      user1: 1,
      user2: 999,
    });

    expect(result).toEqual({
      user1: 1,
      user2: 999,
    });
  });
});
