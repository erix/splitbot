import { describe, it, expect } from "vitest";
import { simplifyDebts } from "../../src/engine/index.js";
import type { Balance } from "../../src/types/index.js";

describe("simplifyDebts", () => {
  it("should simplify A->B->C chain into A->C", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: -1000 }, // Owes 1000
      { userId: "bob", balance: 0 }, // Even
      { userId: "charlie", balance: 1000 }, // Owed 1000
    ];

    const settlements = simplifyDebts(balances);

    // Should be one transaction: alice pays charlie 1000
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toEqual({
      from: "alice",
      to: "charlie",
      amount: 1000,
    });
  });

  it("should handle circular debts", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 500 }, // Owed 500
      { userId: "bob", balance: -300 }, // Owes 300
      { userId: "charlie", balance: -200 }, // Owes 200
    ];

    const settlements = simplifyDebts(balances);

    // Should minimize transactions
    const totalSettled = settlements.reduce((sum, s) => sum + s.amount, 0);
    expect(totalSettled).toBe(500); // Total debt to settle

    // Verify settlements balance out
    const balanceCheck: Record<string, number> = {};
    for (const settlement of settlements) {
      balanceCheck[settlement.from] = (balanceCheck[settlement.from] || 0) - settlement.amount;
      balanceCheck[settlement.to] = (balanceCheck[settlement.to] || 0) + settlement.amount;
    }

    // After settlements, net should match original
    expect(balanceCheck.alice || 0).toBeCloseTo(500, 0);
    expect(balanceCheck.bob || 0).toBeCloseTo(-300, 0);
    expect(balanceCheck.charlie || 0).toBeCloseTo(-200, 0);
  });

  it("should return empty array when already settled", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 0 },
      { userId: "bob", balance: 0 },
      { userId: "charlie", balance: 0 },
    ];

    const settlements = simplifyDebts(balances);
    expect(settlements).toEqual([]);
  });

  it("should handle two-person simple debt", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 1000 },
      { userId: "bob", balance: -1000 },
    ];

    const settlements = simplifyDebts(balances);

    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toEqual({
      from: "bob",
      to: "alice",
      amount: 1000,
    });
  });

  it("should minimize transaction count for complex scenario", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 1000 },
      { userId: "bob", balance: -500 },
      { userId: "charlie", balance: -300 },
      { userId: "dave", balance: -200 },
    ];

    const settlements = simplifyDebts(balances);

    // Should use at most n-1 transactions (3 in this case)
    expect(settlements.length).toBeLessThanOrEqual(3);

    // Verify total amounts balance
    const totalPaid = settlements.reduce((sum, s) => sum + s.amount, 0);
    expect(totalPaid).toBe(1000);
  });

  it("should handle large group with multiple creditors and debtors", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 500 },
      { userId: "bob", balance: 300 },
      { userId: "charlie", balance: -400 },
      { userId: "dave", balance: -200 },
      { userId: "eve", balance: -200 },
    ];

    const settlements = simplifyDebts(balances);

    // Calculate net balance after settlements
    const finalBalances: Record<string, number> = {
      alice: 500,
      bob: 300,
      charlie: -400,
      dave: -200,
      eve: -200,
    };

    for (const settlement of settlements) {
      finalBalances[settlement.from] += settlement.amount;
      finalBalances[settlement.to] -= settlement.amount;
    }

    // All balances should be approximately zero after settlements
    Object.values(finalBalances).forEach((balance) => {
      expect(Math.abs(balance)).toBeLessThan(1);
    });
  });
});
