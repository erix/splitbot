import { ExpenseRepo, SettlementRepo } from "../storage/index.js";
import {
  calculateBalances,
  simplifyDebts,
  applySettlement as applySettlementEngine,
} from "../engine/index.js";
import type { Balance, Settlement } from "../types/index.js";

export class BalanceService {
  private expenseRepo: ExpenseRepo;
  private settlementRepo: SettlementRepo;

  constructor(expenseRepo: ExpenseRepo, settlementRepo: SettlementRepo) {
    this.expenseRepo = expenseRepo;
    this.settlementRepo = settlementRepo;
  }

  async getGroupBalances(groupId: string): Promise<Balance[]> {
    const expenses = await this.expenseRepo.findByGroupId(groupId);
    const settlements = await this.settlementRepo.findByGroupId(groupId);

    // Calculate balances from expenses
    let balances = calculateBalances(expenses);

    // Apply all settlements
    for (const settlement of settlements) {
      balances = applySettlementEngine(balances, {
        from: settlement.from,
        to: settlement.to,
        amount: settlement.amount,
      });
    }

    return balances;
  }

  async getSimplifiedDebts(groupId: string): Promise<Settlement[]> {
    const balances = await this.getGroupBalances(groupId);
    return simplifyDebts(balances);
  }

  async recordSettlement(
    id: string,
    groupId: string,
    from: string,
    to: string,
    amountCents: number,
    recordedBy: string
  ): Promise<void> {
    await this.settlementRepo.create({
      id,
      groupId,
      from,
      to,
      amount: amountCents,
      createdBy: recordedBy,
    });
  }

  async getGroupSettlements(groupId: string) {
    return this.settlementRepo.findByGroupId(groupId);
  }
}
