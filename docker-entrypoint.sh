#!/bin/sh
set -e

echo "=== CamAI Starting ==="

# Validate critical env vars
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "  [WARN] GEMINI_API_KEY не задан — AI-анализ (Gemini) не будет работать."
  echo "         Пользователи могут добавить свой ключ в Настройки → ИИ-анализ."
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "  [INFO] TELEGRAM_BOT_TOKEN не задан — Telegram-уведомления отключены."
fi

# Run database migrations
echo "[1/2] Applying database migrations..."
node /app/node_modules/prisma/build/index.js migrate deploy 2>/dev/null || echo "  Migrations already up to date"

# Seed default data if database is fresh
echo "[2/2] Checking seed data..."
node /app/node_modules/prisma/build/index.js db seed 2>/dev/null || echo "  Seed already applied"

# Seed demo data if DEMO_SEED is set
if [ "${DEMO_SEED}" = "1" ]; then
  echo "[3/3] Seeding demo data..."
  npx tsx prisma/seed-demo.ts
fi

echo "=== CamAI Ready on port ${PORT:-3000} ==="

# Start the app
exec "$@"
