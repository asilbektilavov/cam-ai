#!/bin/bash
set -euo pipefail

# ============================================
# CamAI — Production Deploy Script
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---- 1. Check Docker ----
log "Проверяю Docker..."
command -v docker >/dev/null 2>&1 || error "Docker не установлен. Установите: https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || error "Docker daemon не запущен"
docker compose version >/dev/null 2>&1 || error "Docker Compose не найден"
log "Docker OK"

# ---- 2. Create .env if missing ----
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    log "Создаю .env из .env.example..."
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    else
        error ".env.example не найден"
    fi
fi

# ---- 3. Generate NEXTAUTH_SECRET if empty ----
if grep -q '^NEXTAUTH_SECRET=$' "$ENV_FILE" 2>/dev/null || ! grep -q 'NEXTAUTH_SECRET' "$ENV_FILE"; then
    SECRET=$(openssl rand -base64 32)
    if grep -q 'NEXTAUTH_SECRET' "$ENV_FILE"; then
        sed -i.bak "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=$SECRET|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
        echo "NEXTAUTH_SECRET=$SECRET" >> "$ENV_FILE"
    fi
    log "NEXTAUTH_SECRET сгенерирован"
fi

# ---- 4. Validate required vars ----
log "Проверяю переменные окружения..."
source "$ENV_FILE"

if [ -z "${NEXTAUTH_SECRET:-}" ]; then
    error "NEXTAUTH_SECRET не задан в .env"
fi

if [ -z "${NEXTAUTH_URL:-}" ]; then
    warn "NEXTAUTH_URL не задан, будет использован http://localhost:3000"
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
    warn "GEMINI_API_KEY не задан — AI-функции не будут работать"
fi

# ---- 5. SSL certificates ----
SSL_DIR="$PROJECT_DIR/nginx/ssl"
mkdir -p "$SSL_DIR"

DOMAIN="${DOMAIN:-}"

if [ -n "$DOMAIN" ] && [ -n "${CERTBOT_EMAIL:-}" ]; then
    log "Домен: $DOMAIN — Let's Encrypt сертификат будет получен через certbot"
    # Certbot получит сертификат после запуска nginx
    # Пока создаём self-signed для первого запуска
    if [ ! -f "$SSL_DIR/cert.pem" ]; then
        log "Создаю временный self-signed сертификат..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$SSL_DIR/key.pem" \
            -out "$SSL_DIR/cert.pem" \
            -subj "/CN=$DOMAIN" 2>/dev/null
    fi
else
    # LAN mode — self-signed certificate
    if [ ! -f "$SSL_DIR/cert.pem" ]; then
        log "Домен не указан — создаю self-signed сертификат для LAN..."
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout "$SSL_DIR/key.pem" \
            -out "$SSL_DIR/cert.pem" \
            -subj "/CN=cam-ai-local" 2>/dev/null
        log "Self-signed сертификат создан (10 лет)"
    fi
fi

# ---- 6. Build Docker images ----
log "Собираю Docker образы..."
docker compose -f "$COMPOSE_FILE" build --no-cache

# ---- 7. Start containers ----
log "Запускаю контейнеры..."
docker compose -f "$COMPOSE_FILE" up -d

# ---- 8. Wait for health check ----
log "Жду health check..."
MAX_WAIT=120
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' cam-ai-app 2>/dev/null || echo "starting")
    if [ "$STATUS" = "healthy" ]; then
        log "Приложение запущено и healthy!"
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."
done
echo ""

if [ $ELAPSED -ge $MAX_WAIT ]; then
    warn "Health check таймаут. Проверьте логи: docker logs cam-ai-app"
fi

# ---- 9. Setup cron jobs ----
log "Настраиваю cron задачи..."

BACKUP_CRON="0 2 * * * $PROJECT_DIR/scripts/backup.sh >> /var/log/cam-ai-backup.log 2>&1"
SSL_CRON="0 3 * * 1 $PROJECT_DIR/nginx/ssl-renew.sh >> /var/log/cam-ai-ssl.log 2>&1"

(crontab -l 2>/dev/null | grep -v "cam-ai" || true; echo "$BACKUP_CRON"; echo "$SSL_CRON") | crontab - 2>/dev/null || warn "Не удалось настроить cron. Настройте вручную."

# ---- Done ----
echo ""
log "============================================"
log "CamAI успешно запущен!"
log "============================================"
echo ""
log "HTTP:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
log "HTTPS: https://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
echo ""
log "Полезные команды:"
log "  Логи:      docker compose -f $COMPOSE_FILE logs -f"
log "  Статус:    docker compose -f $COMPOSE_FILE ps"
log "  Стоп:      docker compose -f $COMPOSE_FILE down"
log "  Бэкап:     $PROJECT_DIR/scripts/backup.sh"
echo ""
