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

## Run tests after changes
```bash
npm test -- --run
```

## Commit when done
```bash
git add src/bot/ && git commit -m "feat: redesign bot UX with reply keyboard and conversational flow"
```
