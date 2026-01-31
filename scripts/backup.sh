#!/bin/bash
set -euo pipefail

# ============================================
# CamAI — SQLite Backup Script
# Cron: 0 2 * * * (ежедневно в 2:00)
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
CONTAINER_NAME="cam-ai-app"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/cam-ai-backup-$DATE.db"
KEEP_DAYS=7

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log()   { echo -e "${GREEN}[BACKUP]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; }
error() { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; exit 1; }

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    error "Контейнер $CONTAINER_NAME не запущен"
fi

# Try safe backup via sqlite3 .backup (preferred)
log "Создаю бэкап SQLite..."

if docker exec "$CONTAINER_NAME" which sqlite3 >/dev/null 2>&1; then
    # Safe online backup via sqlite3
    docker exec "$CONTAINER_NAME" sqlite3 /app/prisma/dev.db ".backup '/tmp/backup.db'" 2>/dev/null
    docker cp "$CONTAINER_NAME:/tmp/backup.db" "$BACKUP_FILE"
    docker exec "$CONTAINER_NAME" rm -f /tmp/backup.db
    log "Бэкап создан через sqlite3 .backup (безопасный метод)"
else
    # Fallback: copy file directly
    log "sqlite3 не найден, копирую файл напрямую..."
    docker cp "$CONTAINER_NAME:/app/prisma/dev.db" "$BACKUP_FILE"
    log "Бэкап создан через docker cp (менее безопасный метод)"
fi

# Verify backup
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log "Бэкап успешен: $BACKUP_FILE ($SIZE)"
else
    error "Файл бэкапа пуст или не создан"
fi

# Rotate old backups (keep KEEP_DAYS days)
DELETED=$(find "$BACKUP_DIR" -name "cam-ai-backup-*.db" -mtime +"$KEEP_DAYS" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    log "Удалено старых бэкапов: $DELETED"
fi

log "Готово. Хранится бэкапов за последние $KEEP_DAYS дней."
