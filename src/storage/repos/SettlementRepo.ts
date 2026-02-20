import { eq, desc } from "drizzle-orm";
import { db } from "../db.js";
import { settlements } from "../schema.js";

export interface SettlementRecord {
  id: string;
  groupId: string;
  from: string;
  to: string;
  amount: number;
  createdAt: Date;
  createdBy: string;
}

export class SettlementRepo {
  async create(settlement: Omit<SettlementRecord, "createdAt">): Promise<SettlementRecord> {
    const now = new Date();

    await db.insert(settlements).values({
      id: settlement.id,
      groupId: settlement.groupId,
      fromUserId: settlement.from,
      toUserId: settlement.to,
      amount: settlement.amount,
      createdAt: now,
      createdBy: settlement.createdBy,
    });

    return {
      ...settlement,
      createdAt: now,
    };
  }

  async findById(id: string): Promise<SettlementRecord | null> {
    const settlement = await db.select().from(settlements).where(eq(settlements.id, id)).get();

    if (!settlement) return null;

    return {
      id: settlement.id,
      groupId: settlement.groupId,
      from: settlement.fromUserId,
      to: settlement.toUserId,
      amount: settlement.amount,
      createdAt: settlement.createdAt,
      createdBy: settlement.createdBy,
    };
  }

  async findByGroupId(groupId: string): Promise<SettlementRecord[]> {
    const records = await db
      .select()
      .from(settlements)
      .where(eq(settlements.groupId, groupId))
      .orderBy(desc(settlements.createdAt));

    return records.map((s) => ({
      id: s.id,
      groupId: s.groupId,
      from: s.fromUserId,
      to: s.toUserId,
      amount: s.amount,
      createdAt: s.createdAt,
      createdBy: s.createdBy,
    }));
  }

  async delete(id: string): Promise<void> {
    await db.delete(settlements).where(eq(settlements.id, id));
  }
}
