#!/usr/bin/env bash
#
# CamAI Installer — universal setup for Ubuntu/Debian (ARM64 + x86_64)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/.../scripts/install.sh | bash
#   # or locally:
#   bash scripts/install.sh
#
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { err "$*"; exit 1; }

# ── Pre-checks ──────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Запустите от root: sudo bash install.sh"
[[ -f /etc/debian_version ]] || die "Поддерживается только Ubuntu/Debian"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  DOCKER_ARCH="amd64"; GO2RTC_ARCH="amd64" ;;
  aarch64) DOCKER_ARCH="arm64"; GO2RTC_ARCH="arm64" ;;
  *)       die "Неподдерживаемая архитектура: $ARCH" ;;
esac

INSTALL_DIR="/opt/camai"
REPO_URL="https://github.com/asilbektilavov/cam-ai.git"
BRANCH="main"
COMPOSE_FILE="docker-compose.prod.yml"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         CamAI Installer v1.0             ║${NC}"
echo -e "${GREEN}║   Архитектура: ${ARCH}                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. System packages ──────────────────────────────────────────────
info "Обновление системных пакетов..."
apt-get update -qq
apt-get install -y -qq curl git wget gnupg lsb-release ca-certificates apt-transport-https > /dev/null 2>&1
ok "Системные пакеты установлены"

# ── 2. Docker ───────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  ok "Docker уже установлен: $(docker --version)"
else
  info "Установка Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  ok "Docker установлен"
fi

# Ensure Docker Compose plugin
if docker compose version &>/dev/null; then
  ok "Docker Compose доступен: $(docker compose version --short)"
else
  info "Установка Docker Compose plugin..."
  apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
  ok "Docker Compose установлен"
fi

# ── 3. Tailscale ────────────────────────────────────────────────────
if command -v tailscale &>/dev/null; then
  ok "Tailscale уже установлен"
else
  info "Установка Tailscale (удалённый доступ)..."
  curl -fsSL https://tailscale.com/install.sh | sh
  ok "Tailscale установлен"
fi

# Check Tailscale status
if tailscale status &>/dev/null; then
  TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "не определён")
  ok "Tailscale подключён: $TAILSCALE_IP"
else
  warn "Tailscale не подключён. Выполните после установки:"
  echo "    sudo tailscale up --ssh"
  echo "  (--ssh включает Tailscale SSH — подключение без ключей)"
fi

# Enable Tailscale to auto-start on boot
systemctl enable tailscaled 2>/dev/null || true

# ── 4. Clone/Update repo ───────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Обновление репозитория..."
  cd "$INSTALL_DIR"
  git fetch origin
  git reset --hard "origin/$BRANCH"
  ok "Репозиторий обновлён"
else
  info "Клонирование репозитория в $INSTALL_DIR..."
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  ok "Репозиторий склонирован"
fi

cd "$INSTALL_DIR"

# ── 5. Generate .env ────────────────────────────────────────────────
if [[ -f .env ]]; then
  warn ".env уже существует — пропускаю генерацию"
else
  info "Генерация .env..."

  NEXTAUTH_SECRET=$(openssl rand -base64 32)
  DB_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)

  # read from /dev/tty so it works via curl | bash (stdin is pipe)
  GEMINI_KEY=""
  TG_TOKEN=""
  if [[ -t 0 ]] || [[ -e /dev/tty ]]; then
    echo ""
    echo -e "${YELLOW}Опциональные настройки (Enter = пропустить):${NC}"
    read -rp "  GEMINI_API_KEY (для AI-анализа): " GEMINI_KEY < /dev/tty || true
    read -rp "  TELEGRAM_BOT_TOKEN (для уведомлений): " TG_TOKEN < /dev/tty || true
  else
    warn "Неинтерактивный режим — пропускаю ввод ключей. Добавьте позже в .env"
  fi

  cat > .env <<EOF
# CamAI — auto-generated $(date +%Y-%m-%d)
DB_PASSWORD=$DB_PASSWORD
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
NEXTAUTH_URL=http://localhost:3000
GEMINI_API_KEY=${GEMINI_KEY:-}
TELEGRAM_BOT_TOKEN=${TG_TOKEN:-}
EOF

  chmod 600 .env
  ok ".env создан (секреты сгенерированы)"
fi

# ── 6. Self-signed SSL (for nginx) ─────────────────────────────────
SSL_DIR="$INSTALL_DIR/nginx/ssl"
if [[ ! -f "$SSL_DIR/cert.pem" ]]; then
  info "Генерация self-signed SSL..."
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$SSL_DIR/key.pem" \
    -out "$SSL_DIR/cert.pem" \
    -subj "/CN=camai-local" \
    > /dev/null 2>&1
  ok "SSL сертификат создан"
else
  ok "SSL сертификат уже существует"
fi

# ── 7. Build & Start ───────────────────────────────────────────────
info "Сборка Docker-образов (может занять 5-15 минут)..."
docker compose -f "$COMPOSE_FILE" build

info "Запуск сервисов..."
docker compose -f "$COMPOSE_FILE" up -d

ok "Все сервисы запущены"

# ── 8. Systemd service (auto-start on reboot) ──────────────────────
info "Настройка автозапуска при перезагрузке..."

cat > /etc/systemd/system/camai.service <<EOF
[Unit]
Description=CamAI Video Surveillance Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose -f $COMPOSE_FILE up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f $COMPOSE_FILE down
ExecReload=/usr/bin/docker compose -f $COMPOSE_FILE restart
TimeoutStartSec=300
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable camai.service
ok "Systemd-сервис 'camai' создан и включён"

# ── 9. Summary ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              CamAI установлен!                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

LOCAL_IP=$(hostname -I | awk '{print $1}')
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "не настроен")

echo -e "  Локальный доступ:   ${BLUE}http://${LOCAL_IP}:3000${NC}"
echo -e "  Tailscale доступ:   ${BLUE}http://${TAILSCALE_IP}:3000${NC}"
echo -e "  Директория:         ${INSTALL_DIR}"
echo -e "  Конфиг:             ${INSTALL_DIR}/.env"
echo ""
echo -e "  ${YELLOW}Управление:${NC}"
echo "    docker compose -f $INSTALL_DIR/$COMPOSE_FILE logs -f"
echo "    docker compose -f $INSTALL_DIR/$COMPOSE_FILE restart"
echo "    bash $INSTALL_DIR/scripts/manage.sh status"
echo ""

if ! tailscale status &>/dev/null; then
  echo -e "  ${YELLOW}Не забудьте подключить Tailscale:${NC}"
  echo "    sudo tailscale up"
  echo ""
fi

echo -e "  ${YELLOW}При отключении питания сервисы автоматически${NC}"
echo -e "  ${YELLOW}перезапустятся после загрузки системы.${NC}"
echo ""
