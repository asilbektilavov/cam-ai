#!/bin/bash
set -e

# ============================================
# CamAI SaaS — Hetzner Server Setup
# Запуск: curl -sL <url>/setup-server.sh | bash
# Или:    bash scripts/setup-server.sh
# Tested: Ubuntu 22.04 / 24.04 LTS
# ============================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
  err "Запустите от root: sudo bash $0"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   CamAI SaaS — Server Setup          ║"
echo "║   Hetzner Cloud (Ubuntu)              ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ---- 1. System update ----
log "Обновление пакетов..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

# ---- 2. Essential packages ----
log "Установка базовых пакетов..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl wget git ufw fail2ban unattended-upgrades \
  apt-transport-https ca-certificates gnupg lsb-release \
  htop ncdu jq

# ---- 3. Docker ----
if command -v docker &>/dev/null; then
  warn "Docker уже установлен: $(docker --version)"
else
  log "Установка Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  log "Docker установлен: $(docker --version)"
fi

# Docker Compose plugin check
if docker compose version &>/dev/null; then
  warn "Docker Compose уже установлен"
else
  log "Установка Docker Compose plugin..."
  apt-get install -y -qq docker-compose-plugin
fi

# ---- 4. Firewall (UFW) ----
log "Настройка firewall..."
ufw --force reset >/dev/null 2>&1
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
log "Firewall: SSH(22), HTTP(80), HTTPS(443)"

# ---- 5. Fail2ban ----
log "Настройка fail2ban..."
cat > /etc/fail2ban/jail.local << 'JAIL'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 7200
JAIL

systemctl enable fail2ban
systemctl restart fail2ban
log "Fail2ban: SSH защита (3 попытки = бан 2 часа)"

# ---- 6. Swap (2GB) ----
if swapon --show | grep -q "/swapfile"; then
  warn "Swap уже настроен"
else
  log "Создание swap 2GB..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Optimize swap usage
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  log "Swap 2GB создан (swappiness=10)"
fi

# ---- 7. Automatic security updates ----
log "Настройка автообновлений безопасности..."
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT
systemctl enable unattended-upgrades

# ---- 8. System tuning ----
log "Оптимизация ядра..."
cat >> /etc/sysctl.conf << 'SYSCTL'

# CamAI optimizations
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
fs.file-max = 65535
SYSCTL
sysctl -p >/dev/null 2>&1

# ---- 9. Deploy user ----
if id "deploy" &>/dev/null; then
  warn "Пользователь deploy уже существует"
else
  log "Создание пользователя deploy..."
  useradd -m -s /bin/bash -G docker deploy
  # Copy SSH keys from root
  mkdir -p /home/deploy/.ssh
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/deploy/.ssh/
  fi
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true
  log "Пользователь deploy создан (группа docker)"
fi

# ---- 10. App directory ----
APP_DIR="/opt/camai"
if [ -d "$APP_DIR" ]; then
  warn "Директория $APP_DIR уже существует"
else
  log "Создание директории приложения..."
  mkdir -p "$APP_DIR"
  chown deploy:deploy "$APP_DIR"
fi

# ---- 11. Backup cron ----
log "Настройка cron для бэкапов..."
mkdir -p /opt/camai/backups
chown deploy:deploy /opt/camai/backups

# Daily backup at 3:00 AM
CRON_LINE="0 3 * * * cd /opt/camai && bash scripts/backup-pg.sh >> /var/log/camai-backup.log 2>&1"
(crontab -u deploy -l 2>/dev/null | grep -v "backup-pg.sh"; echo "$CRON_LINE") | crontab -u deploy -
log "Бэкап БД: ежедневно в 03:00"

# ---- Done ----
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Сервер настроен!                            ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                                ║"
echo "║   Следующие шаги:                              ║"
echo "║                                                ║"
echo "║   1. Войти как deploy:                         ║"
echo "║      ssh deploy@<IP>                           ║"
echo "║                                                ║"
echo "║   2. Клонировать репозиторий:                  ║"
echo "║      cd /opt/camai                             ║"
echo "║      git clone <repo-url> .                    ║"
echo "║      git checkout saas                         ║"
echo "║                                                ║"
echo "║   3. Запустить деплой:                         ║"
echo "║      DOMAIN=camai.uz bash scripts/deploy-saas.sh ║"
echo "║                                                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
log "Docker: $(docker --version | cut -d' ' -f3)"
log "Firewall: активен (22, 80, 443)"
log "Fail2ban: SSH защита"
log "Swap: $(free -h | awk '/Swap/{print $2}')"
log "Автообновления: включены"
echo ""
