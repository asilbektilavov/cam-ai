#!/bin/bash
# ============================================
# CamAI SaaS — PostgreSQL Backup Script
# Cron: 0 3 * * * cd /opt/camai && bash scripts/backup-pg.sh
# ============================================

set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.saas.yml}"
KEEP_DAILY=7
KEEP_WEEKLY=4
DATE=$(date +%Y-%m-%d_%H%M)
DAY_OF_WEEK=$(date +%u)

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting PostgreSQL backup..."

# Dump database
BACKUP_FILE="$BACKUP_DIR/camai_${DATE}.sql.gz"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U camai -d camai --no-owner --no-acl \
  | gzip > "$BACKUP_FILE"

# Verify backup is not empty
FILESIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "0")
if [ "$FILESIZE" -lt 100 ]; then
  echo "[$(date)] ERROR: Backup file is too small ($FILESIZE bytes). Deleting."
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "[$(date)] Backup created: $BACKUP_FILE ($FILESIZE bytes)"

# Weekly backup (Sunday = 7)
if [ "$DAY_OF_WEEK" -eq 7 ]; then
  WEEKLY_DIR="$BACKUP_DIR/weekly"
  mkdir -p "$WEEKLY_DIR"
  cp "$BACKUP_FILE" "$WEEKLY_DIR/camai_weekly_${DATE}.sql.gz"
  echo "[$(date)] Weekly backup saved"

  # Rotate weekly (keep last N)
  ls -1t "$WEEKLY_DIR"/camai_weekly_*.sql.gz 2>/dev/null | tail -n +$((KEEP_WEEKLY + 1)) | xargs rm -f 2>/dev/null || true
fi

# Rotate daily (keep last N)
ls -1t "$BACKUP_DIR"/camai_*.sql.gz 2>/dev/null | tail -n +$((KEEP_DAILY + 1)) | xargs rm -f 2>/dev/null || true

echo "[$(date)] Backup complete. Daily: $KEEP_DAILY, Weekly: $KEEP_WEEKLY"
