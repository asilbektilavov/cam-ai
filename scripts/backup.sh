#!/bin/bash
set -euo pipefail

# ============================================
# CamAI — PostgreSQL Backup Script
# Cron: 0 2 * * * (ежедневно в 2:00)
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
DB_CONTAINER="camai-db"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/cam-ai-backup-$DATE.sql.gz"
KEEP_DAYS=7

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log()   { echo -e "${GREEN}[BACKUP]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; }
error() { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; exit 1; }

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
    error "Контейнер $DB_CONTAINER не запущен"
fi

# PostgreSQL dump via pg_dump inside container
log "Создаю бэкап PostgreSQL..."

docker exec "$DB_CONTAINER" pg_dump -U camai -d camai --clean --if-exists | gzip > "$BACKUP_FILE"

# Verify backup
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log "Бэкап успешен: $BACKUP_FILE ($SIZE)"
else
    error "Файл бэкапа пуст или не создан"
fi

# Rotate old backups (keep KEEP_DAYS days)
DELETED=$(find "$BACKUP_DIR" -name "cam-ai-backup-*.sql.gz" -mtime +"$KEEP_DAYS" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
    log "Удалено старых бэкапов: $DELETED"
fi

log "Готово. Хранится бэкапов за последние $KEEP_DAYS дней."
log "Восстановление: gunzip -c BACKUP.sql.gz | docker exec -i $DB_CONTAINER psql -U camai -d camai"
