#!/usr/bin/env node

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

function printHelp() {
  console.log(`Usage:
  node scripts/import-csv-backup.mjs [options]

Options:
  --file <path>        CSV backup file to import (default: latest file in BACKUP_DIR)
  --db <path>          SQLite database path (default: DATABASE_PATH or ./data/splitbot.db)
  --out-dir <path>     Backup directory used when --file is omitted (default: BACKUP_DIR or ./data/backups)
  --prefix <name>      Backup filename prefix when --file is omitted (default: BACKUP_PREFIX or splitbot-ledger)
  --mode <mode>        Import mode: append | replace (default: append)
  --force              Required when using --mode=replace
  -h, --help           Show this help text

Examples:
  npm run restore:csv -- --file ./data/backups/splitbot-ledger-20260220-152944Z.csv
  npm run restore:csv -- --mode replace --force --file ./data/backups/splitbot-ledger-20260220-152944Z.csv`);
}

function parseArgs(argv) {
  const args = {
    positional: [],
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      args.help = true;
      continue;
    }

    if (token === "--force") {
      args.force = true;
      continue;
    }

    if (token.startsWith("--file=")) {
      args.file = token.slice("--file=".length);
      continue;
    }

    if (token === "--file") {
      args.file = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--db=")) {
      args.db = token.slice("--db=".length);
      continue;
    }

    if (token === "--db") {
      args.db = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--out-dir=")) {
      args.outDir = token.slice("--out-dir=".length);
      continue;
    }

    if (token === "--out-dir") {
      args.outDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--prefix=")) {
      args.prefix = token.slice("--prefix=".length);
      continue;
    }

    if (token === "--prefix") {
      args.prefix = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--mode=")) {
      args.mode = token.slice("--mode=".length);
      continue;
    }

    if (token === "--mode") {
      args.mode = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    }

    args.positional.push(token);
  }

  return args;
}

function requireValue(optionName, value) {
  if (!value) {
    throw new Error(`Missing value for ${optionName}`);
  }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLatestBackupFile(outDir, prefix) {
  if (!fs.existsSync(outDir)) {
    throw new Error(`Backup directory not found: ${outDir}`);
  }

  const matcher = new RegExp(`^${escapeRegex(prefix)}-\\d{8}-\\d{6}Z\\.csv$`);
  const files = fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    throw new Error(`No backup files found in ${outDir} with prefix "${prefix}"`);
  }

  return path.join(outDir, files[files.length - 1]);
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inQuotes) {
      if (char === "\"") {
        if (content[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }

      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    throw new Error("Invalid CSV: unmatched quote");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.length > 1 || (entry[0] ?? "").trim().length > 0);
}

function toUnixSeconds(value) {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  if (Math.abs(parsed) >= 1_000_000_000_000) {
    return Math.floor(parsed / 1000);
  }

  return Math.floor(parsed);
}

function parseCreatedAtSeconds(row, rowNumber) {
  const rawUnix = row.created_at_unix ?? row.created_at_unix_ms;
  const unixSeconds = toUnixSeconds(rawUnix);

  if (unixSeconds != null) {
    return unixSeconds;
  }

  if (row.created_at_utc) {
    const parsedUtc = Date.parse(row.created_at_utc);
    if (Number.isFinite(parsedUtc)) {
      return Math.floor(parsedUtc / 1000);
    }
  }

  throw new Error(`Row ${rowNumber}: missing or invalid created_at value`);
}

function parseInteger(value, fieldName, rowNumber) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Row ${rowNumber}: invalid ${fieldName}`);
  }
  return parsed;
}

function parseSplitEntry(entry, rowNumber) {
  const colonIndex = entry.lastIndexOf(":");
  if (colonIndex <= 0 || colonIndex === entry.length - 1) {
    throw new Error(`Row ${rowNumber}: invalid split entry "${entry}"`);
  }

  const left = entry.slice(0, colonIndex).trim();
  const amount = parseInteger(entry.slice(colonIndex + 1).trim(), "split amount", rowNumber);

  if (left.endsWith(")") && left.includes("(")) {
    const openParen = left.lastIndexOf("(");
    const closeParen = left.lastIndexOf(")");

    if (openParen >= 0 && closeParen > openParen && closeParen === left.length - 1) {
      return {
        displayName: left.slice(0, openParen).trim(),
        userId: left.slice(openParen + 1, closeParen).trim(),
        amount,
      };
    }
  }

  return {
    displayName: "",
    userId: left,
    amount,
  };
}

function parseSplitList(rawValue, rowNumber) {
  const raw = (rawValue ?? "").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parseSplitEntry(part, rowNumber));
}

function normalizeUserName(displayName, userId) {
  const candidate = (displayName ?? "").trim();

  if (!candidate) {
    return {
      name: userId,
      username: null,
    };
  }

  if (candidate.startsWith("@") && !candidate.includes(" ")) {
    const username = candidate.slice(1).trim();
    if (username) {
      return {
        name: username,
        username,
      };
    }
  }

  return {
    name: candidate,
    username: null,
  };
}

function preferName(currentName, nextName, userId) {
  if (!currentName || currentName === userId) {
    return nextName;
  }

  if (currentName.startsWith("@") && !nextName.startsWith("@")) {
    return nextName;
  }

  return currentName;
}

function preferUsername(currentUsername, nextUsername) {
  if (currentUsername) {
    return currentUsername;
  }

  return nextUsername ?? null;
}

function addUser(usersById, userId, displayName, createdAtSeconds) {
  if (!userId) {
    return;
  }

  const normalized = normalizeUserName(displayName, userId);
  const existing = usersById.get(userId);

  if (!existing) {
    usersById.set(userId, {
      id: userId,
      name: normalized.name,
      username: normalized.username,
      createdAtSeconds,
    });
    return;
  }

  existing.name = preferName(existing.name, normalized.name, userId);
  existing.username = preferUsername(existing.username, normalized.username);
  existing.createdAtSeconds = Math.min(existing.createdAtSeconds, createdAtSeconds);
}

function setUserUsername(usersById, userId, username) {
  if (!userId || !username) {
    return;
  }

  const normalized = username.startsWith("@") ? username.slice(1) : username;
  if (!normalized) {
    return;
  }

  const existing = usersById.get(userId);
  if (!existing) {
    usersById.set(userId, {
      id: userId,
      name: normalized,
      username: normalized,
      createdAtSeconds: Math.floor(Date.now() / 1000),
    });
    return;
  }

  existing.username = preferUsername(existing.username, normalized);
}

function addGroup(groupsById, groupId, groupName, createdAtSeconds, createdBy) {
  if (!groupId) {
    return;
  }

  const existing = groupsById.get(groupId);
  if (!existing) {
    groupsById.set(groupId, {
      id: groupId,
      name: groupName || groupId,
      createdAtSeconds,
      createdBy: createdBy || "",
      memberIds: new Set(),
    });
    return;
  }

  if (groupName && (!existing.name || existing.name === existing.id)) {
    existing.name = groupName;
  }
  existing.createdAtSeconds = Math.min(existing.createdAtSeconds, createdAtSeconds);
  if (!existing.createdBy && createdBy) {
    existing.createdBy = createdBy;
  }
}

function groupMemberId(groupId, userId) {
  return `gm_${groupId}_${userId}`;
}

function addGroupMember(groupMembersByKey, groupsById, groupId, userId, joinedAtSeconds) {
  if (!groupId || !userId) {
    return;
  }

  const group = groupsById.get(groupId);
  if (group) {
    group.memberIds.add(userId);
  }

  const key = `${groupId}::${userId}`;
  const existing = groupMembersByKey.get(key);
  if (!existing) {
    groupMembersByKey.set(key, {
      id: groupMemberId(groupId, userId),
      groupId,
      userId,
      joinedAtSeconds,
    });
    return;
  }

  existing.joinedAtSeconds = Math.min(existing.joinedAtSeconds, joinedAtSeconds);
}

function parseLedgerRows(dataRows) {
  const usersById = new Map();
  const groupsById = new Map();
  const groupMembersByKey = new Map();
  const expenses = [];
  const settlements = [];
  let ignoredRows = 0;

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowType = String(row.row_type ?? "").trim().toLowerCase();

    if (!rowType) {
      throw new Error(`Row ${rowNumber}: missing row_type`);
    }

    const createdAtSeconds = parseCreatedAtSeconds(row, rowNumber);
    const groupId = String(row.group_id ?? "").trim();
    const groupName = String(row.group_name ?? "").trim();
    const createdByUserId = String(row.created_by_user_id ?? "").trim();
    const createdByName = String(row.created_by_name ?? "").trim();

    if (rowType === "user") {
      const userId = String(row.record_id ?? row.from_user_id ?? "").trim();
      const userName = String(row.from_user_name ?? row.created_by_name ?? "").trim();
      const username = String(row.user_username ?? "").trim();

      if (!userId) {
        throw new Error(`Row ${rowNumber}: missing user id in user row`);
      }

      addUser(usersById, userId, userName, createdAtSeconds);
      setUserUsername(usersById, userId, username);
      return;
    }

    if (rowType === "group") {
      const groupIdFromRow = String(row.group_id ?? row.record_id ?? "").trim();
      const groupNameFromRow = String(row.group_name ?? "").trim();

      if (!groupIdFromRow) {
        throw new Error(`Row ${rowNumber}: missing group id in group row`);
      }

      addGroup(groupsById, groupIdFromRow, groupNameFromRow, createdAtSeconds, createdByUserId);
      addUser(usersById, createdByUserId, createdByName, createdAtSeconds);
      return;
    }

    if (rowType === "group_member") {
      const groupIdFromRow = String(row.group_id ?? "").trim();
      const userId = String(row.from_user_id ?? row.to_user_id ?? "").trim();
      const userName = String(row.from_user_name ?? row.to_user_name ?? "").trim();

      if (!groupIdFromRow) {
        throw new Error(`Row ${rowNumber}: missing group_id in group_member row`);
      }
      if (!userId) {
        throw new Error(`Row ${rowNumber}: missing user id in group_member row`);
      }

      addGroup(groupsById, groupIdFromRow, groupName, createdAtSeconds, "");
      addUser(usersById, userId, userName, createdAtSeconds);
      addGroupMember(groupMembersByKey, groupsById, groupIdFromRow, userId, createdAtSeconds);
      return;
    }

    if (rowType !== "expense" && rowType !== "settlement") {
      ignoredRows += 1;
      return;
    }

    if (!groupId) {
      throw new Error(`Row ${rowNumber}: missing group_id`);
    }

    addGroup(groupsById, groupId, groupName, createdAtSeconds, createdByUserId);
    addUser(usersById, createdByUserId, createdByName, createdAtSeconds);
    addGroupMember(groupMembersByKey, groupsById, groupId, createdByUserId, createdAtSeconds);

    if (rowType === "expense") {
      const id = String(row.record_id ?? "").trim();
      const description = String(row.description ?? "").trim();
      const amount = parseInteger(row.total_amount_cents, "total_amount_cents", rowNumber);
      const paidByUserId = String(row.from_user_id ?? "").trim();
      const paidByName = String(row.from_user_name ?? "").trim();
      const splitMethod = String(row.split_method ?? "").trim() || "equal";
      const currency = String(row.currency ?? "").trim() || "USD";
      const splits = parseSplitList(row.participants_and_splits, rowNumber);

      if (!id) {
        throw new Error(`Row ${rowNumber}: missing record_id`);
      }
      if (!paidByUserId) {
        throw new Error(`Row ${rowNumber}: missing from_user_id for expense`);
      }

      const normalizedSplits = splits.length > 0 ? splits : [{ userId: paidByUserId, displayName: paidByName, amount }];
      const splitSum = normalizedSplits.reduce((sum, split) => sum + split.amount, 0);
      if (splitSum !== amount) {
        throw new Error(`Row ${rowNumber}: split sum ${splitSum} does not match total ${amount}`);
      }

      addUser(usersById, paidByUserId, paidByName, createdAtSeconds);
      addGroupMember(groupMembersByKey, groupsById, groupId, paidByUserId, createdAtSeconds);

      normalizedSplits.forEach((split) => {
        if (!split.userId) {
          throw new Error(`Row ${rowNumber}: split contains empty user id`);
        }
        addUser(usersById, split.userId, split.displayName, createdAtSeconds);
        addGroupMember(groupMembersByKey, groupsById, groupId, split.userId, createdAtSeconds);
      });

      expenses.push({
        id,
        groupId,
        description: description || "[expense]",
        amount,
        currency,
        paidByUserId,
        splitMethod,
        createdAtSeconds,
        createdByUserId: createdByUserId || paidByUserId,
        splits: normalizedSplits.map((split) => ({
          userId: split.userId,
          amount: split.amount,
        })),
      });

      return;
    }

    const id = String(row.record_id ?? "").trim();
    const amount = parseInteger(row.total_amount_cents, "total_amount_cents", rowNumber);
    const fromUserId = String(row.from_user_id ?? "").trim();
    const fromUserName = String(row.from_user_name ?? "").trim();
    const toUserId = String(row.to_user_id ?? "").trim();
    const toUserName = String(row.to_user_name ?? "").trim();

    if (!id) {
      throw new Error(`Row ${rowNumber}: missing record_id`);
    }
    if (!fromUserId || !toUserId) {
      throw new Error(`Row ${rowNumber}: missing from_user_id or to_user_id for settlement`);
    }

    addUser(usersById, fromUserId, fromUserName, createdAtSeconds);
    addUser(usersById, toUserId, toUserName, createdAtSeconds);
    addGroupMember(groupMembersByKey, groupsById, groupId, fromUserId, createdAtSeconds);
    addGroupMember(groupMembersByKey, groupsById, groupId, toUserId, createdAtSeconds);

    settlements.push({
      id,
      groupId,
      fromUserId,
      toUserId,
      amount,
      createdAtSeconds,
      createdByUserId: createdByUserId || fromUserId,
    });
  });

  for (const group of groupsById.values()) {
    if (!group.createdBy || !usersById.has(group.createdBy)) {
      const fallback = group.memberIds.values().next().value;
      if (!fallback) {
        throw new Error(`Group ${group.id} has no created_by and no members in backup`);
      }
      group.createdBy = fallback;
    }
  }

  return {
    users: Array.from(usersById.values()),
    groups: Array.from(groupsById.values()).map((group) => ({
      id: group.id,
      name: group.name,
      createdAtSeconds: group.createdAtSeconds,
      createdBy: group.createdBy,
    })),
    groupMembers: Array.from(groupMembersByKey.values()),
    expenses,
    settlements,
    ignoredRows,
  };
}

function ensureSchemaTablesExist(db) {
  const requiredTables = [
    "users",
    "groups",
    "group_members",
    "expenses",
    "expense_splits",
    "settlements",
  ];

  const tableStmt = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  );

  const missing = requiredTables.filter((table) => !tableStmt.get(table));
  if (missing.length > 0) {
    throw new Error(
      `Database is missing required tables: ${missing.join(", ")}. Run "npm run migrate" first.`
    );
  }
}

function importLedger(db, parsed, mode, force) {
  if (mode === "replace" && !force) {
    throw new Error("Replace mode requires --force");
  }

  const result = {
    deleted: {
      settlements: 0,
      expenseSplits: 0,
      expenses: 0,
      groupMembers: 0,
      groups: 0,
      users: 0,
    },
    inserted: {
      users: 0,
      groups: 0,
      groupMembers: 0,
      expenses: 0,
      expenseSplits: 0,
      settlements: 0,
    },
  };

  const deleteSettlements = db.prepare("DELETE FROM settlements");
  const deleteExpenseSplits = db.prepare("DELETE FROM expense_splits");
  const deleteExpenses = db.prepare("DELETE FROM expenses");
  const deleteGroupMembers = db.prepare("DELETE FROM group_members");
  const deleteGroups = db.prepare("DELETE FROM groups");
  const deleteUsers = db.prepare("DELETE FROM users");

  const insertUser = db.prepare(
    "INSERT OR IGNORE INTO users (id, name, username, created_at) VALUES (?, ?, ?, ?)"
  );
  const insertGroup = db.prepare(
    "INSERT OR IGNORE INTO groups (id, name, created_at, created_by) VALUES (?, ?, ?, ?)"
  );
  const insertGroupMember = db.prepare(
    "INSERT OR IGNORE INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)"
  );
  const insertExpense = db.prepare(
    "INSERT OR IGNORE INTO expenses (id, group_id, description, amount, currency, paid_by, split_method, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertExpenseSplit = db.prepare(
    "INSERT OR IGNORE INTO expense_splits (id, expense_id, user_id, amount) VALUES (?, ?, ?, ?)"
  );
  const insertSettlement = db.prepare(
    "INSERT OR IGNORE INTO settlements (id, group_id, from_user_id, to_user_id, amount, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    if (mode === "replace") {
      result.deleted.settlements = deleteSettlements.run().changes;
      result.deleted.expenseSplits = deleteExpenseSplits.run().changes;
      result.deleted.expenses = deleteExpenses.run().changes;
      result.deleted.groupMembers = deleteGroupMembers.run().changes;
      result.deleted.groups = deleteGroups.run().changes;
      result.deleted.users = deleteUsers.run().changes;
    }

    for (const user of parsed.users) {
      result.inserted.users += insertUser.run(
        user.id,
        user.name,
        user.username,
        user.createdAtSeconds
      ).changes;
    }

    for (const group of parsed.groups) {
      result.inserted.groups += insertGroup.run(
        group.id,
        group.name,
        group.createdAtSeconds,
        group.createdBy
      ).changes;
    }

    for (const member of parsed.groupMembers) {
      result.inserted.groupMembers += insertGroupMember.run(
        member.id,
        member.groupId,
        member.userId,
        member.joinedAtSeconds
      ).changes;
    }

    for (const expense of parsed.expenses) {
      result.inserted.expenses += insertExpense.run(
        expense.id,
        expense.groupId,
        expense.description,
        expense.amount,
        expense.currency,
        expense.paidByUserId,
        expense.splitMethod,
        expense.createdAtSeconds,
        expense.createdByUserId
      ).changes;

      for (const split of expense.splits) {
        result.inserted.expenseSplits += insertExpenseSplit.run(
          `${expense.id}_${split.userId}`,
          expense.id,
          split.userId,
          split.amount
        ).changes;
      }
    }

    for (const settlement of parsed.settlements) {
      result.inserted.settlements += insertSettlement.run(
        settlement.id,
        settlement.groupId,
        settlement.fromUserId,
        settlement.toUserId,
        settlement.amount,
        settlement.createdAtSeconds,
        settlement.createdByUserId
      ).changes;
    }
  });

  transaction();
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.file !== undefined) {
    requireValue("--file", args.file);
  }
  if (args.db !== undefined) {
    requireValue("--db", args.db);
  }
  if (args.outDir !== undefined) {
    requireValue("--out-dir", args.outDir);
  }
  if (args.prefix !== undefined) {
    requireValue("--prefix", args.prefix);
  }
  if (args.mode !== undefined) {
    requireValue("--mode", args.mode);
  }

  const mode = (args.mode ?? "append").toLowerCase();
  if (mode !== "append" && mode !== "replace") {
    throw new Error(`Invalid mode: ${mode}. Expected "append" or "replace".`);
  }

  const dbPath = path.resolve(
    process.cwd(),
    args.db ?? process.env.DATABASE_PATH ?? "./data/splitbot.db"
  );
  const outDir = path.resolve(
    process.cwd(),
    args.outDir ?? process.env.BACKUP_DIR ?? "./data/backups"
  );
  const prefix = args.prefix ?? process.env.BACKUP_PREFIX ?? "splitbot-ledger";
  const filePath = args.file
    ? path.resolve(process.cwd(), args.file)
    : findLatestBackupFile(outDir, prefix);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup CSV not found: ${filePath}`);
  }

  const csvContent = fs.readFileSync(filePath, "utf8");
  const csvRows = parseCsv(csvContent);

  if (csvRows.length < 2) {
    throw new Error(`CSV file has no data rows: ${filePath}`);
  }

  const header = csvRows[0];
  const requiredColumns = [
    "row_type",
    "record_id",
    "group_id",
    "group_name",
    "description",
    "total_amount_cents",
    "currency",
    "from_user_id",
    "from_user_name",
    "to_user_id",
    "to_user_name",
    "split_method",
    "participants_and_splits",
    "created_by_user_id",
    "created_by_name",
    "created_at_utc",
  ];

  const hasCreatedAtUnix = header.includes("created_at_unix") || header.includes("created_at_unix_ms");
  if (!hasCreatedAtUnix && !header.includes("created_at_utc")) {
    throw new Error("CSV is missing created_at columns");
  }

  for (const column of requiredColumns) {
    if (!header.includes(column)) {
      throw new Error(`CSV is missing required column: ${column}`);
    }
  }

  const dataRows = csvRows.slice(1).map((cells) => {
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cells[i] ?? "";
    }
    return row;
  });

  const parsed = parseLedgerRows(dataRows);

  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  try {
    ensureSchemaTablesExist(db);
    const result = importLedger(db, parsed, mode, args.force);

    console.log(`Imported backup file: ${filePath}`);
    console.log(`Mode: ${mode}`);
    if (parsed.ignoredRows > 0) {
      console.log(`Ignored rows (unknown row_type): ${parsed.ignoredRows}`);
    }
    if (mode === "replace") {
      console.log(
        `Deleted rows: users=${result.deleted.users}, groups=${result.deleted.groups}, group_members=${result.deleted.groupMembers}, expenses=${result.deleted.expenses}, expense_splits=${result.deleted.expenseSplits}, settlements=${result.deleted.settlements}`
      );
    }
    console.log(
      `Inserted rows: users=${result.inserted.users}, groups=${result.inserted.groups}, group_members=${result.inserted.groupMembers}, expenses=${result.inserted.expenses}, expense_splits=${result.inserted.expenseSplits}, settlements=${result.inserted.settlements}`
    );
    console.log(
      `Parsed entities: users=${parsed.users.length}, groups=${parsed.groups.length}, group_members=${parsed.groupMembers.length}, expenses=${parsed.expenses.length}, settlements=${parsed.settlements.length}`
    );
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Import failed: ${error.message}`);
  process.exit(1);
});
