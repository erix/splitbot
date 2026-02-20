# Repository Guidelines

## Project Structure & Module Organization
`src/` contains production code. Key areas:
`src/engine/` pure business logic (no I/O), `src/storage/` repositories + Drizzle schema, `src/services/` use cases, `src/bot/` Telegram adapter, `src/api/` REST API stub. Output builds go to `dist/`. Tests live in `tests/` and are currently focused on the engine. SQLite data defaults to `./data/splitbot.db`.

## Build, Test, and Development Commands
Use npm scripts from `package.json`:
```bash
npm run dev        # run Telegram bot in watch mode (tsx)
npm run build      # compile TypeScript to dist/
npm test           # run all Vitest tests
npm run test:engine # run engine tests only
npm run migrate    # apply Drizzle schema to SQLite database
```

## Coding Style & Naming Conventions
- TypeScript, strict mode. Use ES modules and keep imports as `../path/index.js`.
- Indentation is 2 spaces; semicolons are used.
- Amounts are integer cents (no floats); keep engine functions pure and side‑effect free.
- Tests use `*.test.ts` naming (see `tests/engine/`).
- There is no formatter/linter configured; match existing file style.

## Testing Guidelines
Tests run with Vitest (`vitest.config.ts`). Engine tests live under `tests/engine/` and cover splitting and balance logic. When adding engine behavior, add or update tests in the same folder and run:
```bash
npm run test:engine
```

## Commit & Pull Request Guidelines
Recent commits follow Conventional Commit prefixes (`feat:`, `docs:`, `chore:`). Use the same pattern with a concise summary.
For PRs, include:
- Summary of changes and rationale
- Test results (command + outcome)
- Linked issue or TODO when applicable
If you touch user-facing bot flows, include a short example command sequence.

## Configuration Tips
Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`. Database path can be overridden via `DATABASE_PATH` (defaults to `./data/splitbot.db`).

## Architecture Notes
Keep the layered design: engine (pure) → services → adapters (bot/API). Storage uses the repository pattern; avoid leaking database specifics into engine code.
