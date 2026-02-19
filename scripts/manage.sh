#!/usr/bin/env bash
#
# CamAI Management CLI
#
# Usage:
#   bash manage.sh status     — статус всех сервисов
#   bash manage.sh logs       — логи (follow)
#   bash manage.sh logs cam-ai — логи конкретного сервиса
#   bash manage.sh restart     — перезапуск всех сервисов
#   bash manage.sh restart cam-ai — перезапуск конкретного сервиса
#   bash manage.sh update     — обновление из git + пересборка
#   bash manage.sh backup     — бэкап PostgreSQL
#   bash manage.sh restore <file> — восстановление из бэкапа
#   bash manage.sh stop       — остановка
#   bash manage.sh start      — запуск
#
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────
INSTALL_DIR="${CAMAI_DIR:-/opt/camai}"
COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_DIR="$INSTALL_DIR/backups"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Auto-detect install dir if running from repo
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/../$COMPOSE_FILE" ]]; then
  INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

cd "$INSTALL_DIR"

# ── Commands ────────────────────────────────────────────────────────

cmd_status() {
  echo -e "${BLUE}═══ CamAI Status ═══${NC}"
  echo ""
  docker compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
  echo ""

  # Disk usage
  echo -e "${BLUE}Диск:${NC}"
  df -h "$INSTALL_DIR" | tail -1 | awk '{printf "  Использовано: %s / %s (%s)\n", $3, $2, $5}'

  # Docker volumes
  echo ""
  echo -e "${BLUE}Docker volumes:${NC}"
  docker system df --format "  Images: {{.ImagesSize}} | Containers: {{.ContainersSize}} | Volumes: {{.VolumesSize}}"

  # Tailscale
  echo ""
  if command -v tailscale &>/dev/null && tailscale status &>/dev/null; then
    TSIP=$(tailscale ip -4 2>/dev/null || echo "?")
    echo -e "${GREEN}Tailscale:${NC} подключён ($TSIP)"
  else
    echo -e "${YELLOW}Tailscale:${NC} не подключён"
  fi
}

cmd_logs() {
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    docker compose -f "$COMPOSE_FILE" logs -f --tail=100 "$service"
  else
    docker compose -f "$COMPOSE_FILE" logs -f --tail=50
  fi
}

cmd_restart() {
  local service="${1:-}"
  if [[ -n "$service" ]]; then
    echo -e "${BLUE}Перезапуск $service...${NC}"
    docker compose -f "$COMPOSE_FILE" restart "$service"
  else
    echo -e "${BLUE}Перезапуск всех сервисов...${NC}"
    docker compose -f "$COMPOSE_FILE" restart
  fi
  echo -e "${GREEN}Готово${NC}"
}

cmd_stop() {
  echo -e "${YELLOW}Остановка CamAI...${NC}"
  docker compose -f "$COMPOSE_FILE" down
  echo -e "${GREEN}Остановлено${NC}"
}

cmd_start() {
  echo -e "${BLUE}Запуск CamAI...${NC}"
  docker compose -f "$COMPOSE_FILE" up -d
  echo -e "${GREEN}Запущено${NC}"
}

cmd_update() {
  echo -e "${BLUE}═══ Обновление CamAI ═══${NC}"

  # Pull latest code
  echo -e "${BLUE}[1/3] Git pull...${NC}"
  git fetch origin
  git reset --hard origin/main
  echo ""

  # Rebuild images
  echo -e "${BLUE}[2/3] Пересборка образов...${NC}"
  docker compose -f "$COMPOSE_FILE" build
  echo ""

  # Restart with new images
  echo -e "${BLUE}[3/3] Перезапуск...${NC}"
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
  echo ""

  # Cleanup old images
  docker image prune -f > /dev/null 2>&1

  echo -e "${GREEN}Обновление завершено!${NC}"
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="$BACKUP_DIR/camai_db_${timestamp}.sql.gz"

  echo -e "${BLUE}Создание бэкапа БД...${NC}"

  docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U camai --clean --if-exists camai | gzip > "$backup_file"

  local size
  size=$(du -h "$backup_file" | cut -f1)
  echo -e "${GREEN}Бэкап создан: $backup_file ($size)${NC}"

  # Keep only last 10 backups
  local count
  count=$(ls -1 "$BACKUP_DIR"/camai_db_*.sql.gz 2>/dev/null | wc -l)
  if [[ "$count" -gt 10 ]]; then
    ls -1t "$BACKUP_DIR"/camai_db_*.sql.gz | tail -n +11 | xargs rm -f
    echo -e "${YELLOW}Старые бэкапы удалены (оставлены последние 10)${NC}"
  fi
}

cmd_restore() {
  local backup_file="${1:-}"
  if [[ -z "$backup_file" ]]; then
    echo "Использование: manage.sh restore <файл.sql.gz>"
    echo ""
    echo "Доступные бэкапы:"
    ls -lh "$BACKUP_DIR"/camai_db_*.sql.gz 2>/dev/null || echo "  (бэкапов нет)"
    exit 1
  fi

  if [[ ! -f "$backup_file" ]]; then
    # Try in backup dir
    backup_file="$BACKUP_DIR/$backup_file"
    [[ -f "$backup_file" ]] || { err "Файл не найден: $1"; exit 1; }
  fi

  echo -e "${YELLOW}ВНИМАНИЕ: Это перезапишет текущую БД!${NC}"
  read -rp "Продолжить? (y/N): " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Отмена"; exit 0; }

  echo -e "${BLUE}Восстановление из $backup_file...${NC}"
  gunzip -c "$backup_file" | docker compose -f "$COMPOSE_FILE" exec -T db \
    psql -U camai -d camai

  echo -e "${GREEN}БД восстановлена${NC}"
}

# ── Main ────────────────────────────────────────────────────────────
case "${1:-help}" in
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" ;;
  restart) cmd_restart "${2:-}" ;;
  stop)    cmd_stop ;;
  start)   cmd_start ;;
  update)  cmd_update ;;
  backup)  cmd_backup ;;
  restore) cmd_restore "${2:-}" ;;
  *)
    echo "CamAI Management CLI"
    echo ""
    echo "Использование: bash manage.sh <команда> [аргумент]"
    echo ""
    echo "Команды:"
    echo "  status            Статус всех сервисов"
    echo "  logs [сервис]     Логи (по умолчанию — все)"
    echo "  restart [сервис]  Перезапуск"
    echo "  stop              Остановить все сервисы"
    echo "  start             Запустить все сервисы"
    echo "  update            Обновление из git + пересборка"
    echo "  backup            Бэкап PostgreSQL"
    echo "  restore <файл>    Восстановление из бэкапа"
    echo ""
    echo "Сервисы: cam-ai, db, detector, attendance, plate, go2rtc, nginx"
    ;;
esac
