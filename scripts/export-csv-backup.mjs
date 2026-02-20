#!/usr/bin/env node

import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

function printHelp() {
  console.log(`Usage:
  node scripts/export-csv-backup.mjs [options]

Options:
  --db <path>            SQLite database path (default: DATABASE_PATH or ./data/splitbot.db)
  --out-dir <path>       Output directory for CSV files (default: BACKUP_DIR or ./data/backups)
  --prefix <name>        Backup filename prefix (default: BACKUP_PREFIX or splitbot-ledger)
  --keep <count>         Keep only the newest N backup files (default: BACKUP_KEEP, disabled if unset)
  --upload-cmd <command> Command to run after export (default: BACKUP_UPLOAD_CMD)
  -h, --help             Show this help text

Upload command receives:
  BACKUP_FILE            Absolute path to the generated CSV
  BACKUP_DIR             Absolute path to output directory`);
}

function parseArgs(argv) {
  const args = {
    positional: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "-h" || token === "--help") {
      args.help = true;
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

    if (token.startsWith("--keep=")) {
      args.keep = token.slice("--keep=".length);
      continue;
    }

    if (token === "--keep") {
      args.keep = argv[i + 1];
      i += 1;
      continue;
    }

    if (token.startsWith("--upload-cmd=")) {
      args.uploadCmd = token.slice("--upload-cmd=".length);
      continue;
    }

    if (token === "--upload-cmd") {
      args.uploadCmd = argv[i + 1];
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

  return value;
}

function formatTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
}

function toUnixMs(unixValue) {
  if (unixValue == null) {
    return undefined;
  }

  const parsed = Number(unixValue);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  // Handle both epoch-seconds and epoch-milliseconds.
  if (Math.abs(parsed) < 1_000_000_000_000) {
    return parsed * 1000;
  }

  return parsed;
}

function formatUtcFromUnix(unixValue) {
  const unixMs = toUnixMs(unixValue);
  if (unixMs == null) {
    return "";
  }

  return new Date(unixMs).toISOString();
}

function escapeCsv(value) {
  if (value == null) {
    return "";
  }

  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

function buildCsv(rows, columns) {
  const lines = [columns.map((column) => escapeCsv(column)).join(",")];

  for (const row of rows) {
    const line = columns.map((column) => escapeCsv(row[column])).join(",");
    lines.push(line);
  }

  return `${lines.join("\n")}\n`;
}

function parseKeepValue(rawKeep) {
  if (rawKeep == null || rawKeep === "") {
    return undefined;
  }

  const parsed = Number.parseInt(String(rawKeep), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid keep count: ${rawKeep}`);
  }

  return parsed;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pruneOldBackups(outDir, prefix, keepCount) {
  const matcher = new RegExp(`^${escapeRegex(prefix)}-\\d{8}-\\d{6}Z\\.csv$`);
  const entries = fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && matcher.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (entries.length <= keepCount) {
    return;
  }

  const filesToDelete = entries.slice(0, entries.length - keepCount);
  for (const filename of filesToDelete) {
    fs.rmSync(path.join(outDir, filename));
  }

  console.log(`Pruned ${filesToDelete.length} old backup file(s).`);
}

function displayName(userRecord) {
  if (!userRecord) {
    return "";
  }

  if (userRecord.name) {
    return userRecord.name;
  }

  return userRecord.username ? `@${userRecord.username}` : userRecord.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
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
  if (args.keep !== undefined) {
    requireValue("--keep", args.keep);
  }
  if (args.uploadCmd !== undefined) {
    requireValue("--upload-cmd", args.uploadCmd);
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
  const keepCount = parseKeepValue(args.keep ?? process.env.BACKUP_KEEP);
  const uploadCmd = args.uploadCmd ?? process.env.BACKUP_UPLOAD_CMD;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const outputFilename = `${prefix}-${formatTimestamp(new Date())}.csv`;
  const outputPath = path.join(outDir, outputFilename);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");

  try {
    const users = db
      .prepare("SELECT id, name, username, created_at FROM users")
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        createdAt: row.created_at,
      }));

    const groups = db
      .prepare("SELECT id, name, created_at, created_by FROM groups")
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        createdBy: row.created_by,
      }));

    const groupMembers = db
      .prepare("SELECT id, group_id, user_id, joined_at FROM group_members")
      .all()
      .map((row) => ({
        id: row.id,
        groupId: row.group_id,
        userId: row.user_id,
        joinedAt: row.joined_at,
      }));

    const expenses = db
      .prepare(
        `
          SELECT id, group_id, description, amount, currency, paid_by, split_method, created_at, created_by
          FROM expenses
          ORDER BY created_at ASC, id ASC
        `
      )
      .all();

    const splits = db
      .prepare(
        `
          SELECT expense_id, user_id, amount
          FROM expense_splits
          ORDER BY expense_id ASC, user_id ASC
        `
      )
      .all();

    const settlements = db
      .prepare(
        `
          SELECT id, group_id, from_user_id, to_user_id, amount, created_at, created_by
          FROM settlements
          ORDER BY created_at ASC, id ASC
        `
      )
      .all();

    const usersById = new Map(users.map((user) => [user.id, user]));
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const splitsByExpenseId = new Map();

    for (const split of splits) {
      const existing = splitsByExpenseId.get(split.expense_id) ?? [];
      const participant = usersById.get(split.user_id);
      existing.push(`${displayName(participant)} (${split.user_id}):${split.amount}`);
      splitsByExpenseId.set(split.expense_id, existing);
    }

    const rows = [];

    for (const user of users) {
      rows.push({
        row_type: "user",
        record_id: user.id,
        group_id: "",
        group_name: "",
        created_at_unix: user.createdAt,
        created_at_utc: formatUtcFromUnix(user.createdAt),
        description: "[user]",
        total_amount_cents: "",
        currency: "",
        from_user_id: user.id,
        from_user_name: displayName(user),
        user_username: user.username ?? "",
        to_user_id: "",
        to_user_name: "",
        split_method: "",
        participants_and_splits: "",
        created_by_user_id: "",
        created_by_name: "",
      });
    }

    for (const group of groups) {
      const createdByUser = usersById.get(group.createdBy);

      rows.push({
        row_type: "group",
        record_id: group.id,
        group_id: group.id,
        group_name: group.name,
        created_at_unix: group.createdAt,
        created_at_utc: formatUtcFromUnix(group.createdAt),
        description: "[group]",
        total_amount_cents: "",
        currency: "",
        from_user_id: "",
        from_user_name: "",
        user_username: "",
        to_user_id: "",
        to_user_name: "",
        split_method: "",
        participants_and_splits: "",
        created_by_user_id: group.createdBy,
        created_by_name: displayName(createdByUser),
      });
    }

    for (const member of groupMembers) {
      const group = groupsById.get(member.groupId);
      const user = usersById.get(member.userId);

      rows.push({
        row_type: "group_member",
        record_id: member.id,
        group_id: member.groupId,
        group_name: group?.name ?? "",
        created_at_unix: member.joinedAt,
        created_at_utc: formatUtcFromUnix(member.joinedAt),
        description: "[group_member]",
        total_amount_cents: "",
        currency: "",
        from_user_id: member.userId,
        from_user_name: displayName(user),
        user_username: user?.username ?? "",
        to_user_id: "",
        to_user_name: "",
        split_method: "",
        participants_and_splits: "",
        created_by_user_id: "",
        created_by_name: "",
      });
    }

    for (const expense of expenses) {
      const group = groupsById.get(expense.group_id);
      const paidBy = usersById.get(expense.paid_by);
      const createdBy = usersById.get(expense.created_by);

      rows.push({
        row_type: "expense",
        record_id: expense.id,
        group_id: expense.group_id,
        group_name: group?.name ?? "",
        created_at_unix: expense.created_at,
        created_at_utc: formatUtcFromUnix(expense.created_at),
        description: expense.description,
        total_amount_cents: expense.amount,
        currency: expense.currency,
        from_user_id: expense.paid_by,
        from_user_name: displayName(paidBy),
        user_username: paidBy?.username ?? "",
        to_user_id: "",
        to_user_name: "",
        split_method: expense.split_method,
        participants_and_splits: (splitsByExpenseId.get(expense.id) ?? []).join("; "),
        created_by_user_id: expense.created_by,
        created_by_name: displayName(createdBy),
      });
    }

    for (const settlement of settlements) {
      const group = groupsById.get(settlement.group_id);
      const fromUser = usersById.get(settlement.from_user_id);
      const toUser = usersById.get(settlement.to_user_id);
      const createdBy = usersById.get(settlement.created_by);

      rows.push({
        row_type: "settlement",
        record_id: settlement.id,
        group_id: settlement.group_id,
        group_name: group?.name ?? "",
        created_at_unix: settlement.created_at,
        created_at_utc: formatUtcFromUnix(settlement.created_at),
        description: "[settlement]",
        total_amount_cents: settlement.amount,
        currency: "",
        from_user_id: settlement.from_user_id,
        from_user_name: displayName(fromUser),
        user_username: fromUser?.username ?? "",
        to_user_id: settlement.to_user_id,
        to_user_name: displayName(toUser),
        split_method: "",
        participants_and_splits: "",
        created_by_user_id: settlement.created_by,
        created_by_name: displayName(createdBy),
      });
    }

    rows.sort((a, b) => {
      const createdAtDiff = Number(toUnixMs(a.created_at_unix)) - Number(toUnixMs(b.created_at_unix));
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }

      const typeDiff = String(a.row_type).localeCompare(String(b.row_type));
      if (typeDiff !== 0) {
        return typeDiff;
      }

      return String(a.record_id).localeCompare(String(b.record_id));
    });

    const csvColumns = [
      "row_type",
      "record_id",
      "group_id",
      "group_name",
      "created_at_unix",
      "created_at_utc",
      "description",
      "total_amount_cents",
      "currency",
      "from_user_id",
      "from_user_name",
      "user_username",
      "to_user_id",
      "to_user_name",
      "split_method",
      "participants_and_splits",
      "created_by_user_id",
      "created_by_name",
    ];

    const csv = buildCsv(rows, csvColumns);
    fs.writeFileSync(outputPath, csv, "utf8");

    console.log(`CSV backup created: ${outputPath}`);
    console.log(`Rows exported: ${rows.length}`);
    console.log(
      `Users: ${users.length}, groups: ${groups.length}, group_members: ${groupMembers.length}, expenses: ${expenses.length}, settlements: ${settlements.length}`
    );

    if (keepCount !== undefined) {
      pruneOldBackups(outDir, prefix, keepCount);
    }

    if (uploadCmd) {
      console.log("Running upload command...");
      execSync(uploadCmd, {
        stdio: "inherit",
        shell: true,
        env: {
          ...process.env,
          BACKUP_FILE: outputPath,
          BACKUP_DIR: outDir,
        },
      });
      console.log("Upload command completed.");
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Backup failed: ${error.message}`);
  process.exit(1);
});
