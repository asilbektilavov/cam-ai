#!/bin/bash
set -e

# ============================================
# CamAI SaaS — Deployment Script
# Запуск: DOMAIN=camai.uz bash scripts/deploy-saas.sh
# ============================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   CamAI SaaS — Deploy                ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ---- Pre-checks ----
if ! command -v docker &>/dev/null; then
  err "Docker не установлен. Запустите: bash scripts/setup-server.sh"
fi

if ! docker compose version &>/dev/null; then
  err "Docker Compose не установлен."
fi

# ---- Domain ----
if [ -z "$DOMAIN" ]; then
  read -p "Введите домен (например camai.uz): " DOMAIN
fi

if [ -z "$DOMAIN" ]; then
  err "Домен обязателен"
fi

# ---- Generate secrets ----
if [ -z "$NEXTAUTH_SECRET" ]; then
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
  log "Сгенерирован NEXTAUTH_SECRET"
fi

if [ -z "$DB_PASSWORD" ]; then
  DB_PASSWORD=$(openssl rand -base64 16 | tr -d '=+/')
  log "Сгенерирован DB_PASSWORD"
fi

# ---- Create .env file ----
cat > .env << EOF
# CamAI SaaS — auto-generated $(date +%Y-%m-%d)
DOMAIN=${DOMAIN}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=https://${DOMAIN}
DB_PASSWORD=${DB_PASSWORD}
PORT=3000
GEMINI_API_KEY=${GEMINI_API_KEY:-}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
DEMO_SEED=${DEMO_SEED:-0}
EOF

log "[1/5] .env файл создан"

# ---- Update Caddyfile ----
cat > Caddyfile << EOF
${DOMAIN} {
	encode gzip

	header {
		X-Frame-Options "SAMEORIGIN"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		X-XSS-Protection "1; mode=block"
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}

	reverse_proxy app:3000
}
EOF

log "[2/5] Caddyfile обновлён для ${DOMAIN}"

# ---- Build ----
log "[3/5] Сборка Docker образов..."
docker compose -f docker-compose.saas.yml build --quiet

# ---- Start ----
log "[4/5] Запуск сервисов..."
docker compose -f docker-compose.saas.yml up -d

# ---- Health check ----
log "[5/5] Проверка запуска..."
echo -n "  Ожидание"

MAX_WAIT=90
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if docker compose -f docker-compose.saas.yml exec -T app wget -q --spider http://localhost:3000/api/health 2>/dev/null; then
    echo ""
    log "Приложение запущено!"
    break
  fi
  echo -n "."
  sleep 3
  WAITED=$((WAITED + 3))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  warn "Таймаут ожидания. Проверьте логи:"
  warn "  docker compose -f docker-compose.saas.yml logs app"
fi

# ---- Run migrations + seed ----
log "Миграции и seed планов..."
docker compose -f docker-compose.saas.yml exec -T app node node_modules/prisma/build/index.js migrate deploy 2>/dev/null || true
docker compose -f docker-compose.saas.yml exec -T app node prisma/compiled/seed-plans.js 2>/dev/null || true

# ---- Summary ----
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   CamAI SaaS Deployed!                        ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                                ║"
echo "║   URL:   https://${DOMAIN}                     "
echo "║   DB:    PostgreSQL (внутри Docker)             "
echo "║                                                ║"
echo "║   Сервисы:                                     "
echo "║     docker compose -f docker-compose.saas.yml ps"
echo "║                                                ║"
echo "║   Логи:                                        "
echo "║     docker compose -f docker-compose.saas.yml logs -f app"
echo "║                                                ║"
echo "║   Бэкап:                                       "
echo "║     bash scripts/backup-pg.sh                  "
echo "║                                                ║"
echo "║   Следующие шаги:                              ║"
echo "║     1. Зарегистрируйтесь на https://${DOMAIN}/register"
echo "║     2. Создайте Agent Token в /agents          "
echo "║     3. Установите Edge Agent у клиента         "
echo "║                                                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
