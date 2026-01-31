#!/bin/bash
set -euo pipefail

# ============================================
# CamAI — SSL Certificate Renewal
# Cron: 0 3 * * 1 (еженедельно, понедельник 3:00)
# ============================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SSL]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; }
warn() { echo -e "${YELLOW}[SSL]${NC} $(date '+%Y-%m-%d %H:%M:%S') $1"; }

# Check if certbot container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "cam-ai-certbot"; then
    warn "Certbot контейнер не найден — возможно используется self-signed сертификат"
    exit 0
fi

log "Обновляю SSL сертификат..."

# Run certbot renewal
docker compose -f "$COMPOSE_FILE" run --rm certbot renew --quiet

# Reload nginx to pick up new cert
docker exec cam-ai-nginx nginx -s reload 2>/dev/null || warn "Не удалось перезагрузить nginx"

log "SSL обновление завершено"
