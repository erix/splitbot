#!/bin/sh
set -e

echo "🗄️  Running database migrations..."
npx drizzle-kit push --yes 2>/dev/null || npx drizzle-kit push

BACKUP_PID=""
BOT_PID=""

is_positive_integer() {
  case "$1" in
    ''|*[!0-9]*)
      return 1
      ;;
    *)
      [ "$1" -gt 0 ]
      ;;
  esac
}

start_backup_loop() {
  interval="${BACKUP_INTERVAL_SECONDS:-0}"

  if [ -z "$interval" ]; then
    interval=0
  fi

  if ! is_positive_integer "$interval" && [ "$interval" != "0" ]; then
    echo "⚠️  Invalid BACKUP_INTERVAL_SECONDS=\"$interval\". Periodic backups disabled."
    return
  fi

  if [ "$interval" -le 0 ]; then
    echo "💾 Periodic CSV backups disabled (set BACKUP_INTERVAL_SECONDS>0 to enable)."
    return
  fi

  mkdir -p "${BACKUP_DIR:-/data/backups}"
  echo "💾 Periodic CSV backups enabled every ${interval}s."

  if [ "${BACKUP_RUN_ON_START:-1}" = "1" ]; then
    echo "💾 Running startup backup..."
    node scripts/export-csv-backup.mjs || echo "⚠️  Startup backup failed."
  fi

  (
    while true; do
      sleep "$interval"
      echo "💾 Running scheduled backup..."
      node scripts/export-csv-backup.mjs || echo "⚠️  Scheduled backup failed."
    done
  ) &
  BACKUP_PID=$!
}

stop_backup_loop() {
  if [ -n "$BACKUP_PID" ]; then
    kill "$BACKUP_PID" 2>/dev/null || true
    wait "$BACKUP_PID" 2>/dev/null || true
  fi
}

on_term() {
  echo "🛑 Received shutdown signal."

  if [ -n "$BOT_PID" ]; then
    kill "$BOT_PID" 2>/dev/null || true
  fi

  stop_backup_loop
  exit 0
}

trap on_term INT TERM

start_backup_loop

echo "🤖 Starting splitbot..."
node dist/bot/index.js &
BOT_PID=$!

set +e
wait "$BOT_PID"
BOT_STATUS=$?
set -e

stop_backup_loop
exit "$BOT_STATUS"
