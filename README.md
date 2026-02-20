# Splitbot

Splitbot is a Splitwise-style expense tracker with:
- a pure TypeScript expense-splitting engine,
- SQLite persistence via Drizzle,
- and a Telegram bot interface built with Grammy.

All money values are stored as integer cents.

## Features

- Persistent Telegram keyboard UI:
  - `💸 Add Expense`
  - `💰 Balances`
  - `✅ Settle Up`
  - `📋 History`
  - `⚙️ Groups`
- Conversational expense flow:
  - amount -> description -> payer -> participants -> confirmation
- Quick command add:
  - `/add <amount> <description>`
- Settlement flow with inline `✅ Mark paid`
- History flow with inline `🗑 Delete`
- Invite links via Telegram deep links:
  - `/invite`
  - `/start join_<groupId>`
- Real Telegram group support:
  - each Telegram group chat auto-maps to one Splitbot group
  - members are synced automatically when they interact with the bot

## How Group Mapping Works

### Private chat with bot
- Create a manual group with `/newgroup <name>`.
- Join via `/join <groupId>` or invite link.
- Active group is stored per chat.

### Real Telegram group chat
- Add bot to a Telegram group.
- Run `/start` once in that group.
- The chat is auto-linked to an internal group ID: `tgchat_<chatId>`.
- People are added to the expense group when they interact with the bot.

Telegram API limitation:
- Bots cannot fetch a full member list for every group member on demand.
- Member sync is interaction/event-based, not a guaranteed full instant import.
- If you want broader message visibility in groups, disable bot privacy in BotFather (`/setprivacy`).

## Architecture

Layered design:

`engine (pure logic) -> services (use cases) -> adapters (bot/api)`

- `src/engine/`: Pure splitting and balance logic, no I/O
- `src/services/`: Use cases combining repositories + engine
- `src/storage/`: SQLite + Drizzle repos/schema
- `src/bot/`: Telegram adapter
- `src/api/`: REST API stub

## Project Structure

```text
src/
  api/
  bot/
  engine/
  services/
  storage/
  types/
tests/
  engine/
```

## Quick Start

### 1. Prerequisites

- Node.js 18+
- npm
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### 2. Install

```bash
npm install
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN` in `.env`.

### 3. Database

```bash
npm run migrate
```

### 4. Run

```bash
npm run dev
```

You should see:

```text
🤖 Splitbot is running...
```

## Commands

Core commands:
- `/start`
- `/help`
- `/add <amount> <description>`
- `/balances`
- `/settle`
- `/history`
- `/groups`
- `/cancel`

Private/group-management commands:
- `/newgroup <name>`
- `/join <groupId>`
- `/invite`

## Example Usage

### Private chat flow

```text
/newgroup Weekend Trip
/add 42 Dinner
/balances
/settle
```

### Telegram group flow

```text
(inside group)
/start
/add 25 Snacks
/balances
```

## Development

```bash
npm run dev         # bot with watch mode
npm run build       # compile TypeScript to dist/
npm test            # all tests
npm run test:engine # engine tests only
npm run migrate     # push Drizzle schema
```

## Testing

Vitest is configured via `vitest.config.ts`.

Engine tests cover:
- equal/percentage/exact splits
- balance calculation
- debt simplification
- settlement application
- splitwise validation datasets (when present)

## Environment

- `TELEGRAM_BOT_TOKEN`: required
- `DATABASE_PATH`: optional, defaults to `./data/splitbot.db`

## Tech Stack

- TypeScript (strict)
- Grammy
- Drizzle ORM
- better-sqlite3
- Vitest
- Express (API stub)

## License

MIT
