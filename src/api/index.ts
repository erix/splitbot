import express from "express";
import { desc, eq } from "drizzle-orm";
import db from "../db.js";
import {
  groups,
  groupMembers,
  GroupRepo,
  ExpenseRepo,
  UserRepo,
  SettlementRepo,
} from "../storage/index.js";
import { GroupService, ExpenseService, BalanceService } from "../services/index.js";
import { simplifyDebts } from "../engine/index.js";
import type { Group, Expense } from "../types/index.js";

const router = express.Router();

const groupRepo = new GroupRepo();
const expenseRepo = new ExpenseRepo();
const userRepo = new UserRepo();
const settlementRepo = new SettlementRepo();

const groupService = new GroupService(groupRepo, userRepo);
const expenseService = new ExpenseService(expenseRepo, userRepo);
const balanceService = new BalanceService(expenseRepo, settlementRepo);

type ApiUser = {
  id: string;
  name: string;
  username?: string;
};

type EnrichedExpense = {
  id: string;
  groupId: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  paidBy: ApiUser;
  participants: ApiUser[];
  splits: Record<string, number>;
  splitMethod: "equal" | "percentage" | "exact";
  createdAt: string;
  createdBy: string;
};

const CATEGORY_ALIASES = new Map<string, string>([
  ["general", "General"],
  ["liquor", "Liquor"],
  ["dining", "Dining out"],
  ["dining out", "Dining out"],
  ["food", "Dining out"],
  ["groceries", "Groceries"],
  ["transport", "Transport"],
  ["travel", "Travel"],
  ["rent", "Rent"],
  ["utilities", "Utilities"],
  ["entertainment", "Entertainment"],
]);

function getSingleQueryParam(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}

function normalizeCategory(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return "General";
  }

  const alias = CATEGORY_ALIASES.get(normalized);
  if (alias) {
    return alias;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function inferCategory(description: string): string {
  const trimmed = description.trim();

  if (!trimmed) {
    return "General";
  }

  const bracketMatch = trimmed.match(/^\[(.+?)\]/);
  if (bracketMatch) {
    return normalizeCategory(bracketMatch[1]);
  }

  const colonMatch = trimmed.match(/^([^:]{2,40}):\s+/);
  if (colonMatch) {
    return normalizeCategory(colonMatch[1]);
  }

  const dashMatch = trimmed.match(/^([^-]{2,40})\s+-\s+/);
  if (dashMatch) {
    return normalizeCategory(dashMatch[1]);
  }

  const lowerDescription = trimmed.toLowerCase();
  for (const [candidate, normalized] of CATEGORY_ALIASES) {
    const pattern = new RegExp(`\\b${candidate.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(lowerDescription)) {
      return normalized;
    }
  }

  return "General";
}

function parseDateQuery(value: string, endOfDay: boolean): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    const parsed = new Date(`${trimmed}${suffix}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function loadUsers(userIds: string[]): Promise<Map<string, ApiUser>> {
  const uniqueUserIds = Array.from(new Set(userIds.filter((userId) => userId.trim().length > 0)));
  const users = await Promise.all(uniqueUserIds.map((userId) => userRepo.findById(userId)));
  const userMap = new Map<string, ApiUser>();

  uniqueUserIds.forEach((userId, index) => {
    const user = users[index];
    userMap.set(userId, {
      id: userId,
      name: user?.name || userId,
      username: user?.username,
    });
  });

  return userMap;
}

async function requireGroup(id: string, res: express.Response): Promise<Group | null> {
  const group = await groupService.getGroup(id);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return null;
  }

  return group;
}

function enrichExpenses(expenses: Expense[], users: Map<string, ApiUser>): EnrichedExpense[] {
  return expenses.map((expense) => ({
    id: expense.id,
    groupId: expense.groupId,
    description: expense.description,
    category: inferCategory(expense.description),
    amount: expense.amount,
    currency: expense.currency,
    paidBy: users.get(expense.paidBy) || { id: expense.paidBy, name: expense.paidBy },
    participants: expense.participants.map((participantId) => {
      return users.get(participantId) || { id: participantId, name: participantId };
    }),
    splits: expense.splits,
    splitMethod: expense.splitMethod,
    createdAt: expense.createdAt.toISOString(),
    createdBy: expense.createdBy,
  }));
}

router.get("/health", (_req, res) => {
  res.json({ status: "ok", message: "Splitbot API" });
});

router.get("/groups", async (_req, res, next) => {
  try {
    const groupRows = await db.select().from(groups).orderBy(desc(groups.createdAt));
    const membershipRows = await db
      .select({
        groupId: groupMembers.groupId,
        userId: groupMembers.userId,
      })
      .from(groupMembers);

    const membersByGroup = new Map<string, Set<string>>();
    for (const membership of membershipRows) {
      if (!membersByGroup.has(membership.groupId)) {
        membersByGroup.set(membership.groupId, new Set());
      }

      membersByGroup.get(membership.groupId)?.add(membership.userId);
    }

    res.json(
      groupRows.map((group) => ({
        id: group.id,
        name: group.name,
        createdAt: group.createdAt.toISOString(),
        createdBy: group.createdBy,
        memberCount: membersByGroup.get(group.id)?.size || 0,
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.get("/groups/:id", async (req, res, next) => {
  try {
    const group = await requireGroup(req.params.id, res);
    if (!group) {
      return;
    }

    const users = await loadUsers(group.members);

    res.json({
      id: group.id,
      name: group.name,
      createdAt: group.createdAt.toISOString(),
      createdBy: group.createdBy,
      memberIds: group.members,
      members: group.members.map((memberId) => {
        const member = users.get(memberId);
        return {
          id: memberId,
          name: member?.name || memberId,
          username: member?.username,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/groups/:id/expenses", async (req, res, next) => {
  try {
    const group = await requireGroup(req.params.id, res);
    if (!group) {
      return;
    }

    const categoryFilterRaw = getSingleQueryParam(req.query.category);
    const fromRaw = getSingleQueryParam(req.query.from);
    const toRaw = getSingleQueryParam(req.query.to);

    const fromDate = fromRaw ? parseDateQuery(fromRaw, false) : undefined;
    if (fromRaw && !fromDate) {
      res.status(400).json({ error: "Invalid from date. Use YYYY-MM-DD or ISO datetime." });
      return;
    }

    const toDate = toRaw ? parseDateQuery(toRaw, true) : undefined;
    if (toRaw && !toDate) {
      res.status(400).json({ error: "Invalid to date. Use YYYY-MM-DD or ISO datetime." });
      return;
    }

    if (fromDate && toDate && fromDate > toDate) {
      res.status(400).json({ error: "from date must be less than or equal to to date." });
      return;
    }

    const expenses = await expenseService.getGroupExpenses(group.id);
    const allUserIds = new Set<string>();
    for (const expense of expenses) {
      allUserIds.add(expense.paidBy);
      for (const participant of expense.participants) {
        allUserIds.add(participant);
      }
    }

    const users = await loadUsers(Array.from(allUserIds));
    let enrichedExpenses = enrichExpenses(expenses, users);

    if (categoryFilterRaw) {
      const categoryFilter = normalizeCategory(categoryFilterRaw);
      enrichedExpenses = enrichedExpenses.filter((expense) => expense.category === categoryFilter);
    }

    if (fromDate || toDate) {
      enrichedExpenses = enrichedExpenses.filter((expense) => {
        const expenseDate = new Date(expense.createdAt);
        if (fromDate && expenseDate < fromDate) {
          return false;
        }

        if (toDate && expenseDate > toDate) {
          return false;
        }

        return true;
      });
    }

    res.json(enrichedExpenses);
  } catch (error) {
    next(error);
  }
});

router.get("/groups/:id/balances", async (req, res, next) => {
  try {
    const group = await requireGroup(req.params.id, res);
    if (!group) {
      return;
    }

    const balances = await balanceService.getGroupBalances(group.id);
    const users = await loadUsers(balances.map((balance) => balance.userId));

    res.json(
      balances.map((balance) => ({
        userId: balance.userId,
        name: users.get(balance.userId)?.name || balance.userId,
        balance: balance.balance,
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.get("/groups/:id/settlements", async (req, res, next) => {
  try {
    const group = await requireGroup(req.params.id, res);
    if (!group) {
      return;
    }

    const balances = await balanceService.getGroupBalances(group.id);
    const settlements = simplifyDebts(balances);

    const allUserIds = new Set<string>();
    for (const settlement of settlements) {
      allUserIds.add(settlement.from);
      allUserIds.add(settlement.to);
    }
    const users = await loadUsers(Array.from(allUserIds));

    res.json(
      settlements.map((settlement) => ({
        from: settlement.from,
        fromName: users.get(settlement.from)?.name || settlement.from,
        to: settlement.to,
        toName: users.get(settlement.to)?.name || settlement.to,
        amount: settlement.amount,
      }))
    );
  } catch (error) {
    next(error);
  }
});

router.get("/groups/:id/stats", async (req, res, next) => {
  try {
    const group = await requireGroup(req.params.id, res);
    if (!group) {
      return;
    }

    const expenses = await expenseService.getGroupExpenses(group.id);
    const totalSpend = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const expenseCount = expenses.length;

    const byCategoryMap = new Map<string, number>();
    const byDayMap = new Map<string, number>();
    const paidMap = new Map<string, number>();
    const owesMap = new Map<string, number>();

    const memberIds = new Set<string>(group.members);

    for (const expense of expenses) {
      const category = inferCategory(expense.description);
      byCategoryMap.set(category, (byCategoryMap.get(category) || 0) + expense.amount);

      const day = dateKey(expense.createdAt);
      byDayMap.set(day, (byDayMap.get(day) || 0) + expense.amount);

      paidMap.set(expense.paidBy, (paidMap.get(expense.paidBy) || 0) + expense.amount);
      memberIds.add(expense.paidBy);

      for (const [userId, amount] of Object.entries(expense.splits)) {
        owesMap.set(userId, (owesMap.get(userId) || 0) + amount);
        memberIds.add(userId);
      }
    }

    const users = await loadUsers(Array.from(memberIds));

    const byCategory = Array.from(byCategoryMap.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);

    const byDay = Array.from(byDayMap.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const byMember = Array.from(memberIds)
      .map((userId) => ({
        userId,
        name: users.get(userId)?.name || userId,
        paid: paidMap.get(userId) || 0,
        owes: owesMap.get(userId) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      totalSpend,
      expenseCount,
      byCategory,
      byDay,
      byMember,
    });
  } catch (error) {
    next(error);
  }
});

router.use((_req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: "API endpoint not found.",
  });
});

router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Internal Server Error";
  res.status(500).json({
    error: "Internal Server Error",
    message,
  });
});

export default router;
