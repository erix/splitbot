import { describe, it, expect } from "vitest";
import { calculateBalances } from "../../src/engine/index.js";
import type { Expense } from "../../src/types/index.js";

describe("calculateBalances", () => {
  it("should calculate balance for single expense", () => {
    const expenses: Expense[] = [
      {
        id: "exp1",
        groupId: "grp1",
        description: "Dinner",
        amount: 3000,
        currency: "USD",
        paidBy: "alice",
        participants: ["alice", "bob", "charlie"],
        splits: {
          alice: 1000,
          bob: 1000,
          charlie: 1000,
        },
        splitMethod: "equal",
        createdAt: new Date(),
        createdBy: "alice",
      },
    ];

    const balances = calculateBalances(expenses);

    // Alice paid 3000 and owes 1000, so balance = +2000
    // Bob paid 0 and owes 1000, so balance = -1000
    // Charlie paid 0 and owes 1000, so balance = -1000
    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 2000 },
        { userId: "bob", balance: -1000 },
        { userId: "charlie", balance: -1000 },
      ])
    );
  });

  it("should calculate balances for multiple expenses", () => {
    const expenses: Expense[] = [
      {
        id: "exp1",
        groupId: "grp1",
        description: "Dinner",
        amount: 3000,
        currency: "USD",
        paidBy: "alice",
        participants: ["alice", "bob"],
        splits: { alice: 1500, bob: 1500 },
        splitMethod: "equal",
        createdAt: new Date(),
        createdBy: "alice",
      },
      {
        id: "exp2",
        groupId: "grp1",
        description: "Taxi",
        amount: 2000,
        currency: "USD",
        paidBy: "bob",
        participants: ["alice", "bob"],
        splits: { alice: 1000, bob: 1000 },
        splitMethod: "equal",
        createdAt: new Date(),
        createdBy: "bob",
      },
    ];

    const balances = calculateBalances(expenses);

    // Alice: paid 3000, owes 2500 (1500+1000) = +500
    // Bob: paid 2000, owes 2500 (1500+1000) = -500
    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 500 },
        { userId: "bob", balance: -500 },
      ])
    );
  });

  it("should handle multiple payers", () => {
    const expenses: Expense[] = [
      {
        id: "exp1",
        groupId: "grp1",
        description: "Lunch",
        amount: 3000,
        currency: "USD",
        paidBy: "alice",
        participants: ["alice", "bob", "charlie"],
        splits: { alice: 1000, bob: 1000, charlie: 1000 },
        splitMethod: "equal",
        createdAt: new Date(),
        createdBy: "alice",
      },
      {
        id: "exp2",
        groupId: "grp1",
        description: "Coffee",
        amount: 1500,
        currency: "USD",
        paidBy: "bob",
        participants: ["alice", "bob", "charlie"],
        splits: { alice: 500, bob: 500, charlie: 500 },
        splitMethod: "equal",
        createdAt: new Date(),
        createdBy: "bob",
      },
    ];

    const balances = calculateBalances(expenses);

    // Alice: paid 3000, owes 1500 = +1500
    // Bob: paid 1500, owes 1500 = 0
    // Charlie: paid 0, owes 1500 = -1500
    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 1500 },
        { userId: "bob", balance: 0 },
        { userId: "charlie", balance: -1500 },
      ])
    );
  });

  it("should return empty array for no expenses", () => {
    const balances = calculateBalances([]);
    expect(balances).toEqual([]);
  });

  it("should handle expense where payer is not a participant", () => {
    const expenses: Expense[] = [
      {
        id: "exp1",
        groupId: "grp1",
        description: "Gift",
        amount: 1000,
        currency: "USD",
        paidBy: "alice",
        participants: ["bob", "charlie"],
        splits: { bob: 500, charlie: 500 },
        splitMethod: "equal",
        createdAt: new Date(),
        createdBy: "alice",
      },
    ];

    const balances = calculateBalances(expenses);

    // Alice: paid 1000, owes 0 = +1000
    // Bob: paid 0, owes 500 = -500
    // Charlie: paid 0, owes 500 = -500
    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 1000 },
        { userId: "bob", balance: -500 },
        { userId: "charlie", balance: -500 },
      ])
    );
  });
});
