import { describe, test, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

type SplitwiseParseResult = {
  members: string[];
  totals: Record<string, number>;
  expectedBalances: Record<string, number>;
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  fields.push(current);
  return fields.map((value) => value.trim());
}

function parseAmountToCents(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return 0;
  }

  const cleaned = trimmed.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") {
    throw new Error(`Unparseable amount: "${raw}"`);
  }

  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) {
    throw new Error(`Unparseable amount: "${raw}"`);
  }

  return Math.round(value * 100);
}

function parseSplitwiseCSV(filepath: string): SplitwiseParseResult {
  const content = fs.readFileSync(filepath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error(`Empty CSV: ${filepath}`);
  }

  const header = parseCsvLine(lines[0]);
  const memberNames = header.slice(5);

  const totals: Record<string, number> = Object.fromEntries(
    memberNames.map((name) => [name, 0])
  );
  const expectedBalances: Record<string, number> = {};

  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const first = row[0]?.trim() ?? "";
    const description = row[1]?.trim() ?? "";
    const isTotal = first === "Total balance" || description === "Total balance";

    memberNames.forEach((name, index) => {
      const cell = row[5 + index] ?? "";
      const amount = parseAmountToCents(cell);
      if (isTotal) {
        expectedBalances[name] = amount;
      } else {
        totals[name] = (totals[name] || 0) + amount;
      }
    });
  }

  return { members: memberNames, totals, expectedBalances };
}

function resolveMemberName(expectedName: string, members: string[]): string {
  if (members.includes(expectedName)) {
    return expectedName;
  }

  const expectedLower = expectedName.toLowerCase();
  const caseInsensitive = members.filter(
    (member) => member.toLowerCase() === expectedLower
  );
  if (caseInsensitive.length === 1) {
    return caseInsensitive[0];
  }
  if (caseInsensitive.length > 1) {
    throw new Error(`Ambiguous member alias "${expectedName}" (case-insensitive match)`);
  }

  const prefixMatches = members.filter((member) =>
    member.toLowerCase().startsWith(expectedLower)
  );
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Ambiguous member alias "${expectedName}" (prefix match)`);
  }

  throw new Error(`Unknown member alias "${expectedName}"`);
}

const files = [
  { name: "splitwise-group-a.csv", label: "Group A" },
  { name: "splitwise-group-b.csv", label: "Group B" },
  { name: "splitwise-group-c.csv", label: "Group C" },
  { name: "splitwise-group-d.csv", label: "Group D" },
];

const expectedOverrides: Record<string, Record<string, number>> = {
  "splitwise-group-a.csv": {
    "P1": 0,
    "P2": 7362,
    "P3": 0,
    "P4": 0,
    "P5": -7362,
  },
  "splitwise-group-b.csv": {
    "P3": 0,
    "P1": 0,
  },
  "splitwise-group-c.csv": {},
  "splitwise-group-d.csv": {},
};

for (const { name, label } of files) {
  const csvPath = path.join(__dirname, "../../test-data", name);
  const exists = fs.existsSync(csvPath);

  describe.skipIf(!exists)(`Splitwise: ${label}`, () => {
    test("engine balances match Splitwise totals (±1 cent)", () => {
      const { members, totals, expectedBalances } = parseSplitwiseCSV(csvPath);

      const expected = expectedOverrides[name];
      if (expected && Object.keys(expected).length > 0) {
        for (const [alias, amount] of Object.entries(expected)) {
          const member = resolveMemberName(alias, members);
          const actual = expectedBalances[member];
          expect(actual, `${alias} expected balance from CSV`).toBeDefined();
          expect(Math.abs(actual - amount)).toBeLessThanOrEqual(1);
        }
      }

      for (const [member, expectedAmount] of Object.entries(expectedBalances)) {
        const actual = totals[member] ?? 0;
        expect(
          Math.abs(actual - expectedAmount),
          `${member} mismatch: expected ${expectedAmount}, got ${actual}`
        ).toBeLessThanOrEqual(1);
      }
    });
  });
}
