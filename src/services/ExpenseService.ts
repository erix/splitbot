import { ExpenseRepo, UserRepo } from "../storage/index.js";
import {
  splitEqually,
  splitByPercentage,
  splitByExactAmounts,
} from "../engine/index.js";
import type { Expense, SplitMethod } from "../types/index.js";

export class ExpenseService {
  private expenseRepo: ExpenseRepo;
  private userRepo: UserRepo;

  constructor(expenseRepo: ExpenseRepo, userRepo: UserRepo) {
    this.expenseRepo = expenseRepo;
    this.userRepo = userRepo;
  }

  async createExpense(params: {
    id: string;
    groupId: string;
    description: string;
    amountCents: number;
    currency: string;
    paidBy: string;
    paidByName: string;
    participants: Array<{ id: string; name: string }>;
    splitMethod: SplitMethod;
    shares?: Record<string, number>; // For percentage or exact splits
  }): Promise<Expense> {
    // Ensure payer exists
    let payer = await this.userRepo.findById(params.paidBy);
    if (!payer) {
      payer = await this.userRepo.create({
        id: params.paidBy,
        name: params.paidByName,
      });
    }

    // Ensure all participants exist
    for (const participant of params.participants) {
      let user = await this.userRepo.findById(participant.id);
      if (!user) {
        await this.userRepo.create({
          id: participant.id,
          name: participant.name,
        });
      }
    }

    // Calculate splits based on method
    let splits: Record<string, number>;

    switch (params.splitMethod) {
      case "equal":
        splits = splitEqually(
          params.amountCents,
          params.participants.map((p) => p.id)
        );
        break;

      case "percentage":
        if (!params.shares) {
          throw new Error("Shares required for percentage split");
        }
        splits = splitByPercentage(params.amountCents, params.shares);
        break;

      case "exact":
        if (!params.shares) {
          throw new Error("Shares required for exact split");
        }
        splits = splitByExactAmounts(params.amountCents, params.shares);
        break;

      default:
        throw new Error(`Unknown split method: ${params.splitMethod}`);
    }

    const expense = await this.expenseRepo.create({
      id: params.id,
      groupId: params.groupId,
      description: params.description,
      amount: params.amountCents,
      currency: params.currency,
      paidBy: params.paidBy,
      participants: params.participants.map((p) => p.id),
      splits,
      splitMethod: params.splitMethod,
      createdBy: params.paidBy,
    });

    return expense;
  }

  async getExpense(expenseId: string): Promise<Expense | null> {
    return this.expenseRepo.findById(expenseId);
  }

  async getGroupExpenses(groupId: string): Promise<Expense[]> {
    return this.expenseRepo.findByGroupId(groupId);
  }

  async deleteExpense(expenseId: string): Promise<void> {
    await this.expenseRepo.delete(expenseId);
  }
}
