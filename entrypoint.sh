#!/bin/sh
set -e

echo "🗄️  Running database migrations..."
npx drizzle-kit push --yes 2>/dev/null || npx drizzle-kit push

echo "🤖 Starting splitbot..."
exec node dist/bot/index.js
