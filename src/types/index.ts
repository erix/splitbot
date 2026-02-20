// All amounts are in INTEGER CENTS
export type SplitMethod = "equal" | "percentage" | "exact";

export interface User {
  id: string;
  name: string;
  username?: string;
}

export interface Group {
  id: string;
  name: string;
  members: string[]; // User IDs
  createdAt: Date;
  createdBy: string; // User ID
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number; // cents
  currency: string;
  paidBy: string; // User ID
  participants: string[]; // User IDs
  splits: Record<string, number>; // userId -> cents
  splitMethod: SplitMethod;
  createdAt: Date;
  createdBy: string; // User ID
}

export interface Settlement {
  from: string; // User ID
  to: string; // User ID
  amount: number; // cents
}

export interface Balance {
  userId: string;
  balance: number; // positive = owed money, negative = owes money (cents)
}
