#!/usr/bin/env bash
#
# DSS One-Click Setup — полная установка сервера одной командой.
#
# Что делает:
#   1. Обновляет систему, ставит зависимости
#   2. Устанавливает Docker + Docker Compose
#   3. Устанавливает Tailscale (авто-подключение через auth key)
#   4. Клонирует DSS и собирает Docker-образы
#   5. Генерирует .env с секретами
#   6. Запускает все сервисы
#   7. Настраивает автозапуск (systemd)
#   8. Устанавливает tailscale-notify (уведомления администратору)
#   9. Отправляет в Telegram данные для подключения
#
# Использование:
#   curl -fsSL https://raw.githubusercontent.com/asilbektilavov/cam-ai/line-crossing/scripts/setup.sh | sudo bash
#
# Или с параметрами (без интерактива):
#   curl -fsSL ... | sudo TAILSCALE_AUTH_KEY="tskey-auth-..." bash
#
set -eo pipefail

# ═══════════════════════════════════════════════════════════════════════
# Конфигурация (не меняйте если не знаете что делаете)
# ═══════════════════════════════════════════════════════════════════════
INSTALL_DIR="/opt/camai"
REPO_URL="https://github.com/asilbektilavov/cam-ai.git"
BRANCH="line-crossing"
COMPOSE_FILE="docker-compose.prod.yml"

# Telegram для администратора (tailscale-notify)
ADMIN_TG_TOKEN="8476918566:AAE9l_8Wq6kgsCo3EsyMSov0ugHpgdK_RHk"
ADMIN_TG_CHAT="6418128446"

# Tailscale auth key (опционально, можно передать через env)
TS_AUTH_KEY="${TAILSCALE_AUTH_KEY:-}"

# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[FAIL]${NC} $*" >&2; }
die()   { err "$*"; exit 1; }

step_num=0
step() {
  step_num=$((step_num + 1))
  echo ""
  echo -e "${GREEN}━━━ Шаг ${step_num}: $* ━━━${NC}"
}

send_admin_tg() {
  curl -s -X POST "https://api.telegram.org/bot${ADMIN_TG_TOKEN}/sendMessage" \
    -d "chat_id=${ADMIN_TG_CHAT}" \
    -d "parse_mode=HTML" \
    -d "text=$1" > /dev/null 2>&1 || true
}

# ═══════════════════════════════════════════════════════════════════════
# Pre-checks
# ═══════════════════════════════════════════════════════════════════════
[[ $EUID -eq 0 ]] || die "Запустите от root: curl ... | sudo bash"
[[ -f /etc/debian_version ]] || die "Поддерживается только Ubuntu/Debian"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ok "Архитектура: x86_64" ;;
  aarch64) ok "Архитектура: ARM64" ;;
  *)       die "Неподдерживаемая архитектура: $ARCH" ;;
esac

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         DSS One-Click Setup v2.0              ║${NC}"
echo -e "${GREEN}║   Digital Security Systems Installer          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════════
# Step 1: System packages
# ═══════════════════════════════════════════════════════════════════════
step "Системные пакеты"
apt-get update -qq 2>/dev/null || true
apt-get install -y -qq \
  curl git wget gnupg lsb-release ca-certificates apt-transport-https \
  openssl > /dev/null 2>&1 || true
ok "Системные пакеты установлены"

# ═══════════════════════════════════════════════════════════════════════
# Step 2: Docker
# ═══════════════════════════════════════════════════════════════════════
step "Docker"
if command -v docker &>/dev/null; then
  ok "Docker уже установлен: $(docker --version | head -1)"
else
  info "Установка Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  ok "Docker установлен"
fi

if docker compose version &>/dev/null; then
  ok "Docker Compose: $(docker compose version --short)"
else
  apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1
  ok "Docker Compose установлен"
fi

# ═══════════════════════════════════════════════════════════════════════
# Step 3: Tailscale
# ═══════════════════════════════════════════════════════════════════════
step "Tailscale (удалённый доступ)"
if command -v tailscale &>/dev/null; then
  ok "Tailscale уже установлен"
else
  info "Установка Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
  ok "Tailscale установлен"
fi

systemctl enable tailscaled 2>/dev/null || true
systemctl start tailscaled 2>/dev/null || true

# Подключение Tailscale
if tailscale status &>/dev/null; then
  ok "Tailscale уже подключён: $(tailscale ip -4 2>/dev/null)"
elif [[ -n "$TS_AUTH_KEY" ]]; then
  info "Авто-подключение Tailscale через auth key..."
  tailscale up --auth-key="$TS_AUTH_KEY" --accept-routes --ssh
  ok "Tailscale подключён: $(tailscale ip -4 2>/dev/null)"
else
  warn "Tailscale не подключён."
  echo ""
  echo -e "  ${YELLOW}После установки выполните:${NC}"
  echo "    sudo tailscale up --accept-routes --ssh"
  echo ""
  echo -e "  ${YELLOW}Или повторите установку с auth key:${NC}"
  echo "    curl ... | sudo TAILSCALE_AUTH_KEY=\"tskey-auth-...\" bash"
  echo ""
  # Попробуем интерактивно
  if [[ -e /dev/tty ]]; then
    read -rp "  Подключить Tailscale сейчас? (y/N): " ts_confirm < /dev/tty || true
    if [[ "$ts_confirm" =~ ^[Yy]$ ]]; then
      tailscale up --accept-routes --ssh
      ok "Tailscale подключён: $(tailscale ip -4 2>/dev/null)"
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════════════
# Step 4: Clone/update repo
# ═══════════════════════════════════════════════════════════════════════
step "Скачивание DSS"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Обновление существующей установки..."
  cd "$INSTALL_DIR"
  git fetch origin
  git reset --hard "origin/$BRANCH"
  ok "Обновлено до последней версии"
else
  info "Клонирование в $INSTALL_DIR..."
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  ok "DSS скачан"
fi

cd "$INSTALL_DIR"

# ═══════════════════════════════════════════════════════════════════════
# Step 5: Generate .env
# ═══════════════════════════════════════════════════════════════════════
step "Конфигурация"
if [[ -f .env ]]; then
  warn ".env уже существует — пропускаю"
else
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
  DB_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)

  GEMINI_KEY=""
  TG_TOKEN=""
  if [[ -e /dev/tty ]]; then
    echo ""
    echo -e "${YELLOW}Опциональные настройки (Enter = пропустить):${NC}"
    read -rp "  GEMINI_API_KEY (для AI-анализа): " GEMINI_KEY < /dev/tty || true
    read -rp "  TELEGRAM_BOT_TOKEN (бот клиента для уведомлений): " TG_TOKEN < /dev/tty || true
  fi

  cat > .env <<EOF
# DSS — auto-generated $(date +%Y-%m-%d)
DB_PASSWORD=$DB_PASSWORD
NEXTAUTH_SECRET=$NEXTAUTH_SECRET
NEXTAUTH_URL=http://localhost:3000
GEMINI_API_KEY=${GEMINI_KEY:-}
TELEGRAM_BOT_TOKEN=${TG_TOKEN:-}
EOF

  chmod 600 .env
  ok ".env создан"
fi

# ═══════════════════════════════════════════════════════════════════════
# Step 6: SSL
# ═══════════════════════════════════════════════════════════════════════
step "SSL сертификат"
SSL_DIR="$INSTALL_DIR/nginx/ssl"
if [[ ! -f "$SSL_DIR/cert.pem" ]]; then
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$SSL_DIR/key.pem" -out "$SSL_DIR/cert.pem" \
    -subj "/CN=dss-local" > /dev/null 2>&1
  ok "Self-signed SSL создан"
else
  ok "SSL уже есть"
fi

# ═══════════════════════════════════════════════════════════════════════
# Step 7: Build & Start
# ═══════════════════════════════════════════════════════════════════════
step "Сборка и запуск (5-15 минут)"
info "Сборка Docker-образов..."
docker compose -f "$COMPOSE_FILE" build

info "Запуск сервисов..."
docker compose -f "$COMPOSE_FILE" up -d
ok "Все сервисы запущены"

# Ждём healthcheck
info "Ожидание готовности (до 2 минут)..."
for i in $(seq 1 24); do
  if docker inspect camai-app --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; then
    ok "DSS готов к работе!"
    break
  fi
  sleep 5
done

# ═══════════════════════════════════════════════════════════════════════
# Step 8: Systemd — автозапуск DSS
# ═══════════════════════════════════════════════════════════════════════
step "Автозапуск"
cat > /etc/systemd/system/camai.service <<EOF
[Unit]
Description=DSS Video Surveillance Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose -f $COMPOSE_FILE up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f $COMPOSE_FILE down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable camai.service
ok "DSS будет автоматически запускаться при загрузке"

# ═══════════════════════════════════════════════════════════════════════
# Step 9: Tailscale-notify — уведомления администратору
# ═══════════════════════════════════════════════════════════════════════
step "Уведомления администратору"
cp "$INSTALL_DIR/scripts/tailscale-notify.sh" /usr/local/bin/tailscale-notify.sh
chmod +x /usr/local/bin/tailscale-notify.sh

cat > /etc/systemd/system/tailscale-notify.service <<EOF
[Unit]
Description=DSS Tailscale Connection Notifier
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
Environment=TELEGRAM_BOT_TOKEN=${ADMIN_TG_TOKEN}
Environment=TELEGRAM_CHAT_ID=${ADMIN_TG_CHAT}
ExecStart=/usr/local/bin/tailscale-notify.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable tailscale-notify
systemctl start tailscale-notify
ok "tailscale-notify установлен — при подключении к сети придёт уведомление в Telegram"

# ═══════════════════════════════════════════════════════════════════════
# Step 10: Отправка уведомления администратору
# ═══════════════════════════════════════════════════════════════════════
step "Отправка уведомления"

LOCAL_IP=$(hostname -I | awk '{print $1}')
TS_IP=$(tailscale ip -4 2>/dev/null || echo "не подключён")
HN=$(hostname 2>/dev/null)
OS_VER=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d'"' -f2)
MACHINE_ID=$(cat /etc/machine-id 2>/dev/null || echo "n/a")
CORES=$(nproc 2>/dev/null || echo "?")
MEM=$(free -h 2>/dev/null | awk '/Mem:/{print $2}')
DISK=$(df -h / 2>/dev/null | awk 'NR==2{print $2}')
DOCKER_ST=$(docker ps --format '{{.Names}}: {{.Status}}' 2>/dev/null | head -10)

MSG="$(cat <<EOF
🆕 <b>Новый DSS сервер установлен!</b>

<b>═══ Подключение ═══</b>
🌐 Tailscale: <code>${TS_IP}</code>
📡 Локальный: <code>${LOCAL_IP}</code>
🖥 Хост: ${HN}

<b>SSH:</b> <code>ssh orangepi@${TS_IP}</code>
<b>Web:</b> <code>http://${TS_IP}:3000</code>
<b>Web (LAN):</b> <code>http://${LOCAL_IP}:3000</code>

<b>Логин:</b> <code>dss-admin@securitysystems.uz</code>
<b>Пароль:</b> <code>DsS#2026!xKm9\$vQr7Lp@3nW</code>

<b>═══ Сервер ═══</b>
${OS_VER} (${ARCH})
CPU: ${CORES} ядер | RAM: ${MEM} | Диск: ${DISK}
Machine ID: <code>${MACHINE_ID}</code>

<b>═══ Docker ═══</b>
<pre>${DOCKER_ST}</pre>

<b>═══ Заметки ═══</b>
• Hardware Guard привязан к machine-id
• tailscale-notify активен
• Автозапуск при перезагрузке настроен
EOF
)"

send_admin_tg "$MSG"
ok "Уведомление отправлено в Telegram"

# ═══════════════════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                DSS успешно установлен!                    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Веб-интерфейс:  ${BLUE}http://${LOCAL_IP}:3000${NC}"
if tailscale status &>/dev/null; then
  echo -e "  Tailscale:      ${BLUE}http://${TS_IP}:3000${NC}"
fi
echo ""
echo -e "  Логин:   ${YELLOW}dss-admin@securitysystems.uz${NC}"
echo -e "  Пароль:  ${YELLOW}DsS#2026!xKm9\$vQr7Lp@3nW${NC}"
echo ""
echo -e "  Управление:  ${BLUE}bash /opt/camai/scripts/manage.sh status${NC}"
echo ""
echo -e "  ${RED}Софт привязан к железу этого сервера.${NC}"
echo -e "  ${RED}Копирование на другой сервер невозможно.${NC}"
echo ""
