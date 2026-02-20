import { describe, it, expect } from "vitest";
import { applySettlement } from "../../src/engine/index.js";
import type { Balance, Settlement } from "../../src/types/index.js";

describe("applySettlement", () => {
  it("should reduce balances correctly when debtor pays creditor", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 1000 }, // Owed 1000
      { userId: "bob", balance: -1000 }, // Owes 1000
    ];

    const settlement: Settlement = {
      from: "bob",
      to: "alice",
      amount: 1000,
    };

    const newBalances = applySettlement(balances, settlement);

    expect(newBalances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 0 },
        { userId: "bob", balance: 0 },
      ])
    );
  });

  it("should handle partial settlement", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 1000 },
      { userId: "bob", balance: -1000 },
    ];

    const settlement: Settlement = {
      from: "bob",
      to: "alice",
      amount: 500,
    };

    const newBalances = applySettlement(balances, settlement);

    expect(newBalances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 500 },
        { userId: "bob", balance: -500 },
      ])
    );
  });

  it("should handle settlement with multiple people", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 1000 },
      { userId: "bob", balance: -500 },
      { userId: "charlie", balance: -500 },
    ];

    const settlement: Settlement = {
      from: "bob",
      to: "alice",
      amount: 500,
    };

    const newBalances = applySettlement(balances, settlement);

    expect(newBalances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 500 },
        { userId: "bob", balance: 0 },
        { userId: "charlie", balance: -500 },
      ])
    );
  });

  it("should create new balance entries if users not in original balances", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 0 },
    ];

    const settlement: Settlement = {
      from: "bob",
      to: "charlie",
      amount: 100,
    };

    const newBalances = applySettlement(balances, settlement);

    expect(newBalances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 0 },
        { userId: "bob", balance: 100 },
        { userId: "charlie", balance: -100 },
      ])
    );
  });

  it("should handle zero amount settlement", () => {
    const balances: Balance[] = [
      { userId: "alice", balance: 1000 },
      { userId: "bob", balance: -1000 },
    ];

    const settlement: Settlement = {
      from: "bob",
      to: "alice",
      amount: 0,
    };

    const newBalances = applySettlement(balances, settlement);

    expect(newBalances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 1000 },
        { userId: "bob", balance: -1000 },
      ])
    );
  });

  it("should handle multiple sequential settlements", () => {
    let balances: Balance[] = [
      { userId: "alice", balance: 1500 },
      { userId: "bob", balance: -1000 },
      { userId: "charlie", balance: -500 },
    ];

    // Bob pays Alice 1000
    balances = applySettlement(balances, {
      from: "bob",
      to: "alice",
      amount: 1000,
    });

    // Charlie pays Alice 500
    balances = applySettlement(balances, {
      from: "charlie",
      to: "alice",
      amount: 500,
    });

    expect(balances).toEqual(
      expect.arrayContaining([
        { userId: "alice", balance: 0 },
        { userId: "bob", balance: 0 },
        { userId: "charlie", balance: 0 },
      ])
    );
  });
});
