# Splitbot — Next Steps

## Status
Engine, storage, services, basic bot, REST stub — all done and tested.
**36/36 tests passing.**

## What needs building: Bot UX Redesign

Rebuild `src/bot/` only. Engine/storage/services are untouched.

### 1. Persistent Reply Keyboard (always shown after every response)
```
Row 1: "💸 Add Expense" | "💰 Balances"
Row 2: "✅ Settle Up"   | "📋 History"
Row 3: "⚙️ Groups"
```

### 2. Active Group (src/bot/state.ts)
- `Map<chatId, groupId>` — in-memory is fine
- Set when user does /newgroup or /join
- All commands use active group, no more typing group IDs

### 3. Conversational Expense Flow
Tap "💸 Add Expense":
1. Bot: "How much?" → await number
2. Bot: "Description?" → await text
3. Bot: "Who paid?" → inline buttons, one per group member (single select)
4. Bot: "Split with?" → inline buttons, multi-select with ✅ toggle + "✅ Done"
5. Bot: "✅ €42.00 for Dinner | Paid by Erik | Split: Anna, Tom (€14.00 each)"

Use a simple state machine (Map<chatId, ConversationState>) in `src/bot/state.ts`.

### 4. Commands (power users)
- `/add <amount> <desc>` — quick add, equal split all members, active group
- `/balances` — show balances for active group
- `/settle` — show debts with "✅ Mark paid" inline buttons
- `/history` — last 10 expenses with 🗑 delete buttons
- `/newgroup <name>` — create + set active
- `/join <groupId>` — join + set active
- `/groups` — list your groups
- `/start` — welcome, register user, show keyboard

### 5. Display formats
```
📊 Weekend Trip
  Erik → Anna: €14.00
  Erik → Tom: €7.50

🎉 All settled up!   ← when empty

Erik owes Anna €14.00  [✅ Mark paid]
```

### 6. User registration on /start
Upsert via UserRepo: Telegram id (as string), first_name, username.

## Technical notes
- Grammy v1 (already installed)
- `ctx.from` for user identity
- Amounts: `parseFloat(input) * 100` → cents; display: `(cents/100).toFixed(2)`
- Edge cases: "❌ No active group. Use /newgroup or /join first."
- Keep bot thin — call services, format output

## Splitwise Export Validation (Golden Dataset)

Real Splitwise exports live in `test-data/` — **never committed to git**.
4 real group exports are already there.

### CSV Format
```
Date,Description,Category,Cost,Currency,<Member1>,<Member2>,...
```
- Each member column: **positive** = this person is owed money (they paid)
- **negative** = this person owes money
- Last row: `Total balance` — the expected final net balance per person
- Rows with Category `Payment` = a settlement between two people

### What to build: `tests/engine/splitwise-validation.test.ts`

#### Parser (helper function)
```typescript
function parseSplitwiseCSV(filepath: string): {
  expenses: Array<{ description: string; members: Record<string, number> }>, // amounts in cents
  expectedBalances: Record<string, number> // from "Total balance" row, in cents
}
```
- Skip the "Total balance" row when building expenses
- Convert EUR amounts → cents (multiply by 100, round to integer)
- Treat ALL rows (including Payments) as balance adjustments — just add them to running totals
- The simplest approach: sum all member columns across all rows → final balance per member

#### Validation logic
```typescript
// Sum all member values across all non-"Total balance" rows
// Compare to the "Total balance" row
// Tolerance: ±1 cent per member (rounding)
```

#### The 4 files and their expected final balances:

**splitwise-ski-2024.csv** (5 people, ski trip Austria 2024)
- Erik: €0.00
- Patrick Schmidt: +€73.62 (is owed)
- Daniel Huber: €0.00
- Mika: €0.00
- Luca Siciliano Viglieri: -€73.62 (owes Patrick)

**splitwise-daniel-erik-2019.csv** (2 people, trip 2019)
- Daniel Huber: €0.00
- Erik Simko: €0.00 (all settled)

**splitwise-ski-2023.csv** (5 people, ski trip 2023)
- All members: €0.00 (all settled)

**splitwise-ski-2019-2020.csv** (6 people, ski trips 2019+2020)
- All members: €0.00 (all settled)

#### Key edge cases to cover:
- Unequal splits (e.g. `ZwiWei Thaya Day 1: 14.66, -7.33, -7.33` → rounding)
- 3-way splits that don't divide evenly
- Payments (Category=Payment) treated correctly
- Multi-year group (2019-2020 file)
- Emoji in descriptions 🍻🛫🧀

### Key insight
If `calculateBalances()` on raw member-column data matches the Splitwise totals
within ±1 cent → engine is correct for real-world use.

The test file should skip gracefully if CSV is missing:
```typescript
import { describe, test, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const files = [
  { name: 'splitwise-ski-2024.csv', label: 'Ski 2024' },
  { name: 'splitwise-daniel-erik-2019.csv', label: 'Daniel+Erik 2019' },
  { name: 'splitwise-ski-2023.csv', label: 'Ski 2023' },
  { name: 'splitwise-ski-2019-2020.csv', label: 'Ski 2019-2020' },
]

for (const { name, label } of files) {
  const csvPath = path.join(__dirname, '../../test-data', name)
  const exists = fs.existsSync(csvPath)

  describe.skipIf(!exists)(`Splitwise: ${label}`, () => {
    test('engine balances match Splitwise totals (±1 cent)', () => {
      // parse, calculate, compare
    })
  })
}
```

---

## Run tests after changes
```bash
npm test -- --run
```

## Commit when done
```bash
git add src/bot/ && git commit -m "feat: redesign bot UX with reply keyboard and conversational flow"
```
