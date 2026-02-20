import { describe, it, expect } from "vitest";
import { splitEqually } from "../../src/engine/index.js";

describe("splitEqually", () => {
  it("should split 1000 cents among 3 people as [333, 333, 334]", () => {
    const result = splitEqually(1000, ["user1", "user2", "user3"]);
    expect(result).toEqual({
      user1: 333,
      user2: 333,
      user3: 334, // Last person gets remainder
    });
  });

  it("should split 100 cents among 2 people as [50, 50]", () => {
    const result = splitEqually(100, ["alice", "bob"]);
    expect(result).toEqual({
      alice: 50,
      bob: 50,
    });
  });

  it("should handle single person getting full amount", () => {
    const result = splitEqually(500, ["solo"]);
    expect(result).toEqual({
      solo: 500,
    });
  });

  it("should handle zero amount", () => {
    const result = splitEqually(0, ["user1", "user2"]);
    expect(result).toEqual({
      user1: 0,
      user2: 0,
    });
  });

  it("should throw error for empty participants array", () => {
    expect(() => splitEqually(100, [])).toThrow("Cannot split among zero participants");
  });

  it("should give remainder to last person (101 / 2 = [50, 51])", () => {
    const result = splitEqually(101, ["user1", "user2"]);
    expect(result).toEqual({
      user1: 50,
      user2: 51,
    });
  });

  it("should handle large remainder (100 / 7)", () => {
    const result = splitEqually(100, ["u1", "u2", "u3", "u4", "u5", "u6", "u7"]);
    const values = Object.values(result);
    const total = values.reduce((sum, val) => sum + val, 0);

    expect(total).toBe(100); // Total should be exact
    expect(result.u7).toBe(14 + 2); // Last person gets base (14) + remainder (2)
  });
});
