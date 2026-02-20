import type { Expense, Settlement, Balance } from "../types/index.js";

/**
 * Split an amount equally among participants
 * Handles rounding by giving remainder to the last person
 * @param amountCents - Total amount in cents
 * @param participants - Array of participant user IDs
 * @returns Record mapping userId to their share in cents
 */
export function splitEqually(
  amountCents: number,
  participants: string[]
): Record<string, number> {
  if (participants.length === 0) {
    throw new Error("Cannot split among zero participants");
  }

  const baseShare = Math.floor(amountCents / participants.length);
  const remainder = amountCents % participants.length;

  const splits: Record<string, number> = {};

  participants.forEach((userId, index) => {
    // Give remainder to the last person
    splits[userId] = baseShare + (index === participants.length - 1 ? remainder : 0);
  });

  return splits;
}

/**
 * Split an amount by percentage shares
 * @param amountCents - Total amount in cents
 * @param shares - Record mapping userId to percentage (must sum to 100)
 * @returns Record mapping userId to their share in cents
 * @throws Error if percentages don't sum to exactly 100
 */
export function splitByPercentage(
  amountCents: number,
  shares: Record<string, number>
): Record<string, number> {
  const totalPercentage = Object.values(shares).reduce((sum, pct) => sum + pct, 0);

  if (Math.abs(totalPercentage - 100) > 0.001) {
    throw new Error(`Percentages must sum to 100, got ${totalPercentage}`);
  }

  const splits: Record<string, number> = {};
  let allocated = 0;
  const userIds = Object.keys(shares);

  userIds.forEach((userId, index) => {
    if (index === userIds.length - 1) {
      // Give remainder to last person to ensure exact total
      splits[userId] = amountCents - allocated;
    } else {
      const share = Math.round((amountCents * shares[userId]) / 100);
      splits[userId] = share;
      allocated += share;
    }
  });

  return splits;
}

/**
 * Split an amount by exact amounts
 * @param amountCents - Total amount in cents
 * @param shares - Record mapping userId to exact amount in cents
 * @returns The shares record (validated)
 * @throws Error if shares don't sum to total amount
 */
export function splitByExactAmounts(
  amountCents: number,
  shares: Record<string, number>
): Record<string, number> {
  const totalShares = Object.values(shares).reduce((sum, amt) => sum + amt, 0);

  if (totalShares !== amountCents) {
    throw new Error(
      `Exact amounts must sum to total (${amountCents}), got ${totalShares}`
    );
  }

  return shares;
}

/**
 * Calculate balances from a list of expenses
 * @param expenses - Array of expenses
 * @returns Array of balances (positive = owed money, negative = owes money)
 */
export function calculateBalances(expenses: Expense[]): Balance[] {
  const balanceMap: Record<string, number> = {};

  for (const expense of expenses) {
    // Payer gets credited the full amount
    balanceMap[expense.paidBy] = (balanceMap[expense.paidBy] || 0) + expense.amount;

    // Each participant gets debited their share
    for (const [userId, share] of Object.entries(expense.splits)) {
      balanceMap[userId] = (balanceMap[userId] || 0) - share;
    }
  }

  return Object.entries(balanceMap).map(([userId, balance]) => ({
    userId,
    balance,
  }));
}

/**
 * Simplify debts to minimize number of transactions (greedy algorithm)
 * @param balances - Array of balances
 * @returns Array of settlements needed to settle all debts
 */
export function simplifyDebts(balances: Balance[]): Settlement[] {
  // Create working copy
  const workingBalances = balances.map((b) => ({ ...b }));
  const settlements: Settlement[] = [];

  while (true) {
    // Find max creditor (person owed the most)
    let maxCreditor = workingBalances.reduce((max, b) =>
      b.balance > max.balance ? b : max
    );

    // Find max debtor (person who owes the most)
    let maxDebtor = workingBalances.reduce((min, b) =>
      b.balance < min.balance ? b : min
    );

    // If both are zero (or close to zero due to rounding), we're done
    if (Math.abs(maxCreditor.balance) < 0.01 && Math.abs(maxDebtor.balance) < 0.01) {
      break;
    }

    // Calculate settlement amount (minimum of what's owed and what's due)
    const settleAmount = Math.min(maxCreditor.balance, -maxDebtor.balance);

    if (settleAmount > 0.01) {
      // Round to cents
      const settleAmountCents = Math.round(settleAmount);

      settlements.push({
        from: maxDebtor.userId,
        to: maxCreditor.userId,
        amount: settleAmountCents,
      });

      // Update balances
      maxCreditor.balance -= settleAmountCents;
      maxDebtor.balance += settleAmountCents;
    } else {
      break;
    }
  }

  return settlements;
}

/**
 * Apply a settlement to balances
 * @param balances - Current balances
 * @param settlement - Settlement to apply
 * @returns Updated balances
 */
export function applySettlement(
  balances: Balance[],
  settlement: Settlement
): Balance[] {
  const balanceMap = new Map(balances.map((b) => [b.userId, b.balance]));

  // Person paying reduces their negative balance (or increases positive)
  const fromBalance = balanceMap.get(settlement.from) || 0;
  balanceMap.set(settlement.from, fromBalance + settlement.amount);

  // Person receiving reduces their positive balance (or increases negative)
  const toBalance = balanceMap.get(settlement.to) || 0;
  balanceMap.set(settlement.to, toBalance - settlement.amount);

  return Array.from(balanceMap.entries()).map(([userId, balance]) => ({
    userId,
    balance,
  }));
}
