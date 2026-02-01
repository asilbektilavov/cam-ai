#!/bin/bash
set -euo pipefail

# ============================================
# CamAI — Установка для клиента
# Использование:
#   bash install-client.sh --key AIzaSy... --company "Магазин Ромашка" --telegram 7123456:AAF...
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

log()   { echo -e "${GREEN}[CamAI]${NC} $1"; }
warn()  { echo -e "${YELLOW}[CamAI]${NC} $1"; }
error() { echo -e "${RED}[CamAI]${NC} $1"; exit 1; }

# ---- Парсинг аргументов ----
GEMINI_API_KEY=""
ADMIN_EMAIL="admin@cam-ai.local"
COMPANY_NAME="CamAI"
INSTALL_DIR="/opt/cam-ai"
TELEGRAM_BOT_TOKEN=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --key) GEMINI_API_KEY="$2"; shift 2;;
    --email) ADMIN_EMAIL="$2"; shift 2;;
    --company) COMPANY_NAME="$2"; shift 2;;
    --dir) INSTALL_DIR="$2"; shift 2;;
    --telegram) TELEGRAM_BOT_TOKEN="$2"; shift 2;;
    *) shift;;
  esac
done

echo ""
echo -e "${BLUE}${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}${BOLD}║       CamAI — Установка системы      ║${NC}"
echo -e "${BLUE}${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# ---- 1. Проверка Docker ----
log "Проверяю Docker..."
if ! command -v docker &>/dev/null; then
    log "Устанавливаю Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker 2>/dev/null || true
    systemctl start docker 2>/dev/null || true
fi

if ! docker info &>/dev/null; then
    error "Docker не запущен. Запустите: systemctl start docker"
fi

if ! docker compose version &>/dev/null; then
    error "Docker Compose не найден"
fi
log "Docker OK"

# ---- 2. Определяю IP адрес ----
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || true)
fi
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="localhost"
fi
log "IP адрес: $LOCAL_IP"

# ---- 3. Генерация секретов ----
NEXTAUTH_SECRET=$(openssl rand -base64 32)
# Генерируем пароль: 8 случайных символов + буква + цифра (соответствует требованиям)
RAW_PASS=$(openssl rand -base64 12 | tr -dc 'a-zA-Z0-9' | head -c 8)
ADMIN_PASSWORD="${RAW_PASS}Qw1"

# ---- 4. Создаю директорию проекта ----
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
log "Директория: $INSTALL_DIR"

# ---- 5. Создаю docker-compose.yml ----
cat > docker-compose.yml << 'COMPOSE_EOF'
version: '3.8'

services:
  cam-ai:
    image: ghcr.io/asilbektilavov/cam-ai:latest
    container_name: cam-ai-app
    restart: unless-stopped
    ports:
      - "80:3000"
    env_file:
      - .env
    volumes:
      - cam-ai-data:/app/data
      - cam-ai-db:/app/prisma
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '2'
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      start_period: 40s
      retries: 3
    labels:
      - "com.centurylinklabs.watchtower.scope=cam-ai"

  watchtower:
    image: containrrr/watchtower
    container_name: cam-ai-watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=86400
      - WATCHTOWER_SCOPE=cam-ai
    labels:
      - "com.centurylinklabs.watchtower.scope=cam-ai"

  mdns:
    image: alpine:3.19
    container_name: cam-ai-mdns
    restart: unless-stopped
    network_mode: host
    command: >
      sh -c "
        apk add --no-cache avahi dbus > /dev/null 2>&1 &&
        sed -i 's/^#host-name=.*/host-name=cam-ai/' /etc/avahi/avahi-daemon.conf &&
        sed -i 's/^host-name=.*/host-name=cam-ai/' /etc/avahi/avahi-daemon.conf &&
        mkdir -p /var/run/dbus &&
        dbus-daemon --system 2>/dev/null;
        avahi-daemon --no-drop-root --no-rlimits
      "

volumes:
  cam-ai-data:
    driver: local
  cam-ai-db:
    driver: local
COMPOSE_EOF

# ---- 6. Создаю .env ----
cat > .env << ENV_EOF
DATABASE_URL=file:./dev.db
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=http://${LOCAL_IP}
GEMINI_API_KEY=${GEMINI_API_KEY}
SETUP_ADMIN_EMAIL=${ADMIN_EMAIL}
SETUP_ADMIN_PASSWORD=${ADMIN_PASSWORD}
SETUP_COMPANY_NAME=${COMPANY_NAME}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
ENV_EOF

chmod 600 .env
log ".env создан (только root может читать)"

# ---- 7. Скачиваю и запускаю ----
log "Скачиваю Docker образы..."
docker compose pull 2>&1 | tail -5

log "Запускаю CamAI..."
docker compose up -d

# ---- 8. Жду health check ----
log "Жду запуска приложения..."
MAX_WAIT=120
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' cam-ai-app 2>/dev/null || echo "starting")
    if [ "$STATUS" = "healthy" ]; then
        break
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
    echo -n "."
done
echo ""

if [ $ELAPSED -ge $MAX_WAIT ]; then
    warn "Приложение долго запускается. Проверьте: docker logs cam-ai-app"
fi

# ---- 9. Настраиваю бэкап через cron ----
BACKUP_CMD="0 3 * * * docker exec cam-ai-app sqlite3 /app/prisma/dev.db \".backup '/app/data/backup-\$(date +\\%Y\\%m\\%d).db'\" 2>/dev/null"
(crontab -l 2>/dev/null | grep -v "cam-ai-app"; echo "$BACKUP_CMD") | crontab - 2>/dev/null || true

# ---- 10. Готово! ----
APP_URL="http://${LOCAL_IP}"

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║     CamAI УСТАНОВЛЕН УСПЕШНО!        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Адрес:${NC}    ${BLUE}${APP_URL}${NC}"
echo -e "  ${BOLD}mDNS:${NC}     ${BLUE}http://cam-ai.local${NC}"
echo -e "  ${BOLD}Логин:${NC}    ${ADMIN_EMAIL}"
echo -e "  ${BOLD}Пароль:${NC}   ${ADMIN_PASSWORD}"
echo ""
echo -e "  ${BOLD}Обновления:${NC} автоматически (каждые 24 часа)"
echo -e "  ${BOLD}Бэкап:${NC}    ежедневно в 3:00"
echo ""
echo -e "  ${YELLOW}ВАЖНО: Запишите логин и пароль!${NC}"
echo -e "  ${YELLOW}Они больше не будут показаны.${NC}"
echo ""
echo -e "  Полезные команды:"
echo -e "  ${BOLD}Логи:${NC}     docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo -e "  ${BOLD}Статус:${NC}   docker compose -f $INSTALL_DIR/docker-compose.yml ps"
echo -e "  ${BOLD}Стоп:${NC}     docker compose -f $INSTALL_DIR/docker-compose.yml down"
echo ""
