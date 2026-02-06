#!/bin/sh
set -e

echo "=== CamAI Starting ==="

# Run database migrations
echo "[1/3] Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy || echo "  Migration error (will retry on next start)"

# Seed plans (idempotent)
echo "[2/3] Seeding plans..."
node prisma/compiled/seed-plans.js 2>/dev/null || echo "  Plans already seeded"

# Seed default data if database is fresh
echo "[3/3] Checking seed data..."
node prisma/compiled/seed.js 2>/dev/null || echo "  Seed already applied"

# Seed demo data if DEMO_SEED is set
if [ "${DEMO_SEED}" = "1" ]; then
  echo "[+] Seeding demo data..."
  node prisma/compiled/seed-demo.js
fi

echo "=== CamAI Ready on port ${PORT:-3000} ==="

# Start the app
exec "$@"
