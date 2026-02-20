import { eq, desc } from "drizzle-orm";
import { db } from "../db.js";
import { expenses, expenseSplits } from "../schema.js";
import type { Expense } from "../../types/index.js";

export class ExpenseRepo {
  async create(expense: Omit<Expense, "createdAt">): Promise<Expense> {
    const now = new Date();

    await db.insert(expenses).values({
      id: expense.id,
      groupId: expense.groupId,
      description: expense.description,
      amount: expense.amount,
      currency: expense.currency,
      paidBy: expense.paidBy,
      splitMethod: expense.splitMethod,
      createdAt: now,
      createdBy: expense.createdBy,
    });

    // Insert splits
    const splitEntries = Object.entries(expense.splits).map(([userId, amount]) => ({
      id: `${expense.id}_${userId}`,
      expenseId: expense.id,
      userId,
      amount,
    }));

    if (splitEntries.length > 0) {
      await db.insert(expenseSplits).values(splitEntries);
    }

    return {
      ...expense,
      createdAt: now,
    };
  }

  async findById(id: string): Promise<Expense | null> {
    const expense = await db.select().from(expenses).where(eq(expenses.id, id)).get();

    if (!expense) return null;

    const splits = await db
      .select()
      .from(expenseSplits)
      .where(eq(expenseSplits.expenseId, id));

    const splitsRecord: Record<string, number> = {};
    const participants: string[] = [];

    for (const split of splits) {
      splitsRecord[split.userId] = split.amount;
      participants.push(split.userId);
    }

    return {
      id: expense.id,
      groupId: expense.groupId,
      description: expense.description,
      amount: expense.amount,
      currency: expense.currency,
      paidBy: expense.paidBy,
      participants,
      splits: splitsRecord,
      splitMethod: expense.splitMethod as "equal" | "percentage" | "exact",
      createdAt: expense.createdAt,
      createdBy: expense.createdBy,
    };
  }

  async findByGroupId(groupId: string): Promise<Expense[]> {
    const expenseRecords = await db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, groupId))
      .orderBy(desc(expenses.createdAt));

    const result: Expense[] = [];

    for (const expense of expenseRecords) {
      const splits = await db
        .select()
        .from(expenseSplits)
        .where(eq(expenseSplits.expenseId, expense.id));

      const splitsRecord: Record<string, number> = {};
      const participants: string[] = [];

      for (const split of splits) {
        splitsRecord[split.userId] = split.amount;
        participants.push(split.userId);
      }

      result.push({
        id: expense.id,
        groupId: expense.groupId,
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        paidBy: expense.paidBy,
        participants,
        splits: splitsRecord,
        splitMethod: expense.splitMethod as "equal" | "percentage" | "exact",
        createdAt: expense.createdAt,
        createdBy: expense.createdBy,
      });
    }

    return result;
  }

  async update(
    id: string,
    data: Partial<Pick<Expense, "description" | "amount" | "currency">>
  ): Promise<Expense | null> {
    await db.update(expenses).set(data).where(eq(expenses.id, id));
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await db.delete(expenses).where(eq(expenses.id, id));
  }
}
