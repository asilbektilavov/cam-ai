#!/bin/sh
set -e

echo "=== CamAI Starting ==="

# Run database migrations
echo "[1/2] Applying database migrations..."
npx prisma migrate deploy 2>/dev/null || echo "  Migrations already up to date"

# Seed default data if database is fresh
echo "[2/2] Checking seed data..."
npx prisma db seed 2>/dev/null || echo "  Seed already applied"

echo "=== CamAI Ready on port ${PORT:-3000} ==="

# Start the app
exec "$@"
