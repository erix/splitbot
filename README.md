# Splitbot

A Splitwise-like expense splitting engine with a Telegram bot frontend. Clean, frontend-agnostic architecture designed for extensibility.

## Architecture

Splitbot follows a layered architecture that separates business logic from I/O:

```
src/
├── types/          # Shared TypeScript interfaces
├── engine/         # Pure business logic (NO I/O)
├── storage/        # Repository pattern with SQLite + Drizzle ORM
├── services/       # Use cases combining engine + storage
├── bot/            # Telegram adapter (Grammy)
└── api/            # REST API stub (Express, 501s only)

tests/
├── engine/         # Comprehensive unit tests
└── services/       # Integration tests (future)
```

### Key Principles

- **Pure Engine**: All business logic is in `src/engine/` as pure functions with no I/O
- **Repository Pattern**: Storage abstraction in `src/storage/` makes it easy to swap databases
- **Frontend Agnostic**: Services layer provides clean API for any frontend (Telegram, REST, CLI, etc.)
- **Type Safety**: Strict TypeScript with all amounts in INTEGER CENTS for precision

## Tech Stack

- **TypeScript** (strict mode)
- **Vitest** - Testing framework
- **better-sqlite3** - SQLite database
- **Drizzle ORM** - Type-safe database toolkit
- **Grammy** - Telegram Bot framework
- **Express** - REST API (stub)
- **dotenv** - Environment configuration

## Core Types

All amounts are in **INTEGER CENTS** to avoid floating-point precision issues.

```typescript
type SplitMethod = "equal" | "percentage" | "exact"

interface Expense {
  id: string
  groupId: string
  description: string
  amount: number // cents
  currency: string
  paidBy: string
  participants: string[]
  splits: Record<string, number> // userId -> cents
  splitMethod: SplitMethod
  createdAt: Date
  createdBy: string
}

interface Settlement {
  from: string
  to: string
  amount: number // cents
}

interface Balance {
  userId: string
  balance: number // positive = owed money, negative = owes money (cents)
}
```

## Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Telegram bot token (from [@BotFather](https://t.me/botfather))

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env and add your Telegram bot token
nano .env

# Run database migration
npm run migrate

# Run tests
npm test

# Run engine tests only
npm run test:engine
```

### Running the Bot

```bash
# Development mode (auto-reload)
npm run dev

# Production mode
npm run build
node dist/bot/index.js
```

### Running the API Stub

```bash
npm run build
node dist/api/index.js
```

Note: The REST API currently returns 501 Not Implemented for all endpoints. Use the Telegram bot.

## Testing

The engine has **36 comprehensive unit tests** covering all edge cases:

```bash
# Run all tests
npm test

# Run only engine tests
npm run test:engine

# Watch mode
npm test -- --watch
```

Test coverage includes:
- `splitEqually`: Rounding, remainders, edge cases
- `splitByPercentage`: Validation, rounding
- `splitByExactAmounts`: Validation
- `calculateBalances`: Single/multiple expenses, multiple payers
- `simplifyDebts`: Chain simplification, circular debts
- `applySettlement`: Balance updates

## Telegram Bot Commands

- `/start` - Welcome message
- `/newgroup <name>` - Create a new group
- `/join <group_id>` - Join an existing group
- `/addexpense <amount> <description>` - Add an expense (split equally)
- `/balances` - View current balances
- `/settle` - See suggested settlements to minimize transactions
- `/history` - View recent expenses
- `/help` - Show help message

### Example Flow

```
/newgroup Weekend Trip
/addexpense 50.00 Dinner at restaurant
/addexpense 30.00 Taxi to hotel
/balances
/settle
```

## Engine API

The pure business logic functions in `src/engine/`:

### Split Functions

```typescript
// Split equally with proper rounding
splitEqually(amountCents: number, participants: string[]): Record<string, number>

// Split by percentage (must sum to 100)
splitByPercentage(amountCents: number, shares: Record<string, number>): Record<string, number>

// Split by exact amounts (must sum to total)
splitByExactAmounts(amountCents: number, shares: Record<string, number>): Record<string, number>
```

### Balance Functions

```typescript
// Calculate balances from expenses
calculateBalances(expenses: Expense[]): Balance[]

// Minimize number of transactions (greedy algorithm)
simplifyDebts(balances: Balance[]): Settlement[]

// Apply a settlement to balances
applySettlement(balances: Balance[], settlement: Settlement): Balance[]
```

## Adding a New Frontend Adapter

Splitbot's architecture makes it easy to add new frontends (CLI, web app, Discord bot, etc.):

1. **Import services**: Use `GroupService`, `ExpenseService`, `BalanceService`
2. **Parse input**: Convert your frontend's input to service method calls
3. **Format output**: Convert service responses to your frontend's format

Example CLI adapter:

```typescript
import { GroupService, ExpenseService, BalanceService } from "./services"
import { UserRepo, GroupRepo, ExpenseRepo, SettlementRepo } from "./storage"

// Initialize repos and services
const groupService = new GroupService(new GroupRepo(), new UserRepo())
const expenseService = new ExpenseService(new ExpenseRepo(), new UserRepo())
const balanceService = new BalanceService(new ExpenseRepo(), new SettlementRepo())

// Parse CLI args and call services
const [command, ...args] = process.argv.slice(2)

if (command === "addexpense") {
  const [groupId, amount, ...desc] = args
  await expenseService.createExpense({
    id: `exp_${Date.now()}`,
    groupId,
    description: desc.join(" "),
    amountCents: Math.round(parseFloat(amount) * 100),
    currency: "USD",
    paidBy: "cli_user",
    paidByName: "CLI User",
    participants: [{ id: "cli_user", name: "CLI User" }],
    splitMethod: "equal"
  })
}
```

## Storage Schema

**users**: id, name, username, createdAt
**groups**: id, name, createdAt, createdBy
**group_members**: id, groupId, userId, joinedAt
**expenses**: id, groupId, description, amount, currency, paidBy, splitMethod, createdAt, createdBy
**expense_splits**: id, expenseId, userId, amount
**settlements**: id, groupId, fromUserId, toUserId, amount, createdAt, createdBy

## Scripts

- `npm run dev` - Run bot in development mode (auto-reload)
- `npm run build` - Build TypeScript to JavaScript
- `npm test` - Run all tests
- `npm run test:engine` - Run engine tests only
- `npm run migrate` - Push database schema changes

## License

MIT

## Contributing

1. Add tests for any new engine functions
2. Keep the engine pure (no I/O)
3. Use INTEGER CENTS for all amounts
4. Follow the repository pattern for storage

---

Built with ❤️ using TypeScript and Claude Code
