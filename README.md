# Splitbot

Splitbot is a Splitwise-style expense tracker with:
- a pure TypeScript expense-splitting engine,
- SQLite persistence via Drizzle,
- and a Telegram bot interface built with Grammy.

All money values are stored as integer cents.

## Features

- Context-aware Telegram keyboard UI:
  - Private chat: `💸 Add Expense`, `💰 Balances`, `✅ Settle Up`, `📋 History`, `⚙️ Groups`
  - Group chat: `/addexpense 💸`, `/balances 💰`, `/settle ✅`, `/history 📋`
- Conversational expense flow:
  - amount -> description -> payer -> participants -> confirmation
  - started via `💸 Add Expense` button or `/addexpense`
- Quick command add:
  - `/add <amount> <description> [@user ...]`
  - if users are tagged, split is among tagged users + expense creator
  - if no users are tagged, split is among all group members
- Settlement flow with inline `✅ Mark paid`
- History flow with inline `🗑 Delete` (only expense owner can delete)
- Invite links via Telegram deep links:
  - `/invite`
  - `/start join_<groupId>`
- Real Telegram group support:
  - each Telegram group chat auto-maps to one Splitbot group
  - members are synced automatically when they interact with the bot
  - `/groups` is available in private chat only

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
🤖 Starting Splitbot as @<your_bot_username>
🤖 Splitbot is running...
```

## Commands

Core commands:
- `/start`
- `/help`
- `/addexpense`
- `/add <amount> <description> [@user ...]`
- `/balances`
- `/settle`
- `/history`
- `/groups` (private chat only)
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
/addexpense
/add 25 Snacks @alice
/balances
```

## Development

```bash
npm run dev         # bot with watch mode
npm run build       # compile TypeScript to dist/
npm test            # all tests
npm run test:engine # engine tests only
npm run migrate     # push Drizzle schema
npm run backup:csv  # export ledger CSV backup
npm run restore:csv # import ledger CSV backup
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
- `BACKUP_DIR`: optional, defaults to `./data/backups`
- `BACKUP_PREFIX`: optional, defaults to `splitbot-ledger`
- `BACKUP_KEEP`: optional retention count, disabled if unset
- `BACKUP_UPLOAD_CMD`: optional command to run after backup. It receives:
  - `BACKUP_FILE`: absolute path to generated CSV
  - `BACKUP_DIR`: absolute path to backup directory
- `BACKUP_INTERVAL_SECONDS`: optional, used by Docker entrypoint. Set `>0` to run periodic backups.
- `BACKUP_RUN_ON_START`: optional, `1` runs one backup at container start when periodic backups are enabled.

## CSV Backup (User-Readable)

Create a timestamped CSV backup:

```bash
npm run backup:csv
```

The CSV includes `users`, `groups`, `group_members`, `expenses`, and `settlements` rows.

Keep only the newest 30 CSV files:

```bash
npm run backup:csv:prune
```

Run backup and upload to S3 (example):

```bash
BACKUP_UPLOAD_CMD='aws s3 cp "$BACKUP_FILE" s3://your-bucket/splitbot/' npm run backup:csv
```

Cron example (every 5 minutes):

```cron
*/5 * * * * cd /home/erix/Projects/splitbot && /usr/bin/npm run backup:csv >> /var/log/splitbot-backup.log 2>&1
```

## Docker Periodic Backups

Container startup now supports periodic backups without host cron:

```bash
docker run -d \
  --name splitbot \
  -e TELEGRAM_BOT_TOKEN=... \
  -e BACKUP_INTERVAL_SECONDS=300 \
  -e BACKUP_RUN_ON_START=1 \
  -v splitbot-data:/data \
  ghcr.io/erix/splitbot:latest
```

Notes:
- Backups are written to `/data/backups` in the container.
- Mount `/data` to a persistent volume, otherwise backups are lost when container is removed.
- If you use `BACKUP_UPLOAD_CMD`, install needed CLI tools in the image (for example `aws` or `rclone`).

## Kubernetes + FluxCD

This repo now includes:
- `k8s/base`: namespace, PVC, deployment
- `k8s/overlays/local`: local overlay used by Flux
- `flux/`: Flux `GitRepository` + `Kustomization` objects for this repo

Apply directly with kubectl:

```bash
kubectl apply -f k8s/base/namespace.yaml
kubectl -n splitbot create secret generic splitbot-secret \
  --from-literal=TELEGRAM_BOT_TOKEN='your_token_here'
kubectl apply -k k8s/overlays/local
```

Enable Flux to watch this repo:

```bash
kubectl apply -k flux/
```

Notes:
- Flux path is set to `./k8s/overlays/local`.
- `k8s/overlays/local/secret.example.yaml` is a template only; do not commit real tokens.
- Deployment mounts persistent data at `/data` via PVC `splitbot-data`.
- Flux image automation is included. It tracks GHCR tags matching `main-<run>-sha-<sha>` and updates `k8s/overlays/local/kustomization.yaml`.
- To let Flux push those updates, create and apply `flux/git-auth-secret.yaml`, then add `spec.secretRef.name: splitbot-flux-git-auth` to `flux/splitbot-gitrepository.yaml`.

## CSV Restore

Import latest backup from `BACKUP_DIR` (append mode, non-destructive):

```bash
npm run restore:csv
```

Import a specific file:

```bash
npm run restore:csv -- --file ./data/backups/splitbot-ledger-20260220-152944Z.csv
```

Replace existing DB contents with backup data:

```bash
npm run restore:csv -- --mode replace --force --file ./data/backups/splitbot-ledger-20260220-152944Z.csv
```

Notes:
- `append` mode uses `INSERT OR IGNORE`, so existing IDs are not overwritten.
- `replace` mode deletes current rows in `users/groups/group_members/expenses/expense_splits/settlements` before import.
- Run `npm run migrate` first if the target DB does not have the schema yet.

## Tech Stack

- TypeScript (strict)
- Grammy
- Drizzle ORM
- better-sqlite3
- Vitest
- Express (API stub)

## License

MIT
