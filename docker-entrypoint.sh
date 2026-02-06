#!/bin/sh
set -e

echo "=== CamAI Starting ==="

# Run database migrations
echo "[1/2] Applying database migrations..."
npx prisma migrate deploy 2>/dev/null || echo "  Migrations already up to date"

# Seed plans (idempotent)
echo "[2/3] Seeding plans..."
npx tsx prisma/seed-plans.ts 2>/dev/null || echo "  Plans already seeded"

# Seed default data if database is fresh
echo "[3/3] Checking seed data..."
npx prisma db seed 2>/dev/null || echo "  Seed already applied"

# Seed demo data if DEMO_SEED is set
if [ "${DEMO_SEED}" = "1" ]; then
  echo "[3/3] Seeding demo data..."
  npx tsx prisma/seed-demo.ts
fi

echo "=== CamAI Ready on port ${PORT:-3000} ==="

# Start the app
exec "$@"
