import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
});

export const groupMembers = sqliteTable("group_members", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: integer("joined_at", { mode: "timestamp" }).notNull(),
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: integer("amount").notNull(), // cents
  currency: text("currency").notNull().default("USD"),
  paidBy: text("paid_by").notNull().references(() => users.id),
  splitMethod: text("split_method").notNull(), // "equal" | "percentage" | "exact"
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
});

export const expenseSplits = sqliteTable("expense_splits", {
  id: text("id").primaryKey(),
  expenseId: text("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(), // cents
});

export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  fromUserId: text("from_user_id").notNull().references(() => users.id),
  toUserId: text("to_user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(), // cents
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
});
