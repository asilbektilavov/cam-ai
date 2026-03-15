#!/bin/bash
# tailscale-notify.sh — При появлении Tailscale отправляет в Telegram
# полную информацию для удалённой диагностики и подключения.
#
# Установка:
#   sudo cp /opt/camai/scripts/tailscale-notify.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/tailscale-notify.sh
#   sudo cp /opt/camai/scripts/tailscale-notify.service /etc/systemd/system/
#   sudo systemctl enable tailscale-notify && sudo systemctl start tailscale-notify

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
CHECK_INTERVAL=60
LAST_STATE_FILE="/tmp/.tailscale-notify-last-state"

send_telegram() {
  [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ] && return 1
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "parse_mode=HTML" \
    -d "text=$1" > /dev/null 2>&1
}

get_msg_main() {
  local ts_ip=$(tailscale ip -4 2>/dev/null || echo "n/a")
  local local_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  local hn=$(hostname 2>/dev/null)
  local up=$(uptime -p 2>/dev/null || echo "n/a")
  local os_ver=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d'"' -f2)
  local kernel=$(uname -r 2>/dev/null)
  local arch=$(uname -m 2>/dev/null)
  local ts_ver=$(tailscale version 2>/dev/null | head -1)
  local cores=$(nproc 2>/dev/null || echo "?")
  local load=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}')
  local mem_total=$(free -h 2>/dev/null | awk '/Mem:/{print $2}')
  local mem_used=$(free -h 2>/dev/null | awk '/Mem:/{print $3}')
  local mem_pct=$(free 2>/dev/null | awk '/Mem:/{printf("%.0f", $3/$2*100)}')
  local disk_info=$(df -h / 2>/dev/null | awk 'NR==2{print $3"/"$2" ("$5" занято)"}')
  local temp_raw=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
  local temp="n/a"
  [ -n "$temp_raw" ] && temp="$((temp_raw / 1000))C"
  local docker_st=$(docker ps --format '{{.Names}}: {{.Status}}' 2>/dev/null | head -10)

  cat <<EOF
$(echo -e '\xF0\x9F\x9F\xA2') <b>DSS Server Online</b>

<b>--- Connection ---</b>
Tailscale: <code>${ts_ip}</code>
Local IP: <code>${local_ip}</code>
Host: ${hn}

SSH: <code>ssh orangepi@${ts_ip}</code>
Web: <code>http://${ts_ip}:3000</code>

<b>--- System ---</b>
${os_ver} (${arch})
Kernel: ${kernel}
Tailscale: ${ts_ver}
Uptime: ${up}

<b>--- Resources ---</b>
CPU: ${cores} cores | Load: ${load}
RAM: ${mem_used}/${mem_total} (${mem_pct}%)
Disk /: ${disk_info}
Temp: ${temp}

<b>--- Docker ---</b>
<pre>${docker_st}</pre>
EOF
}

get_msg_debug() {
  local git_branch=$(cd /opt/camai 2>/dev/null && git branch --show-current 2>/dev/null)
  local git_commit=$(cd /opt/camai 2>/dev/null && git log --oneline -1 2>/dev/null)
  local git_date=$(cd /opt/camai 2>/dev/null && git log -1 --format="%ci" 2>/dev/null | cut -d' ' -f1)
  local ports=$(ss -tlnp 2>/dev/null | grep -E ':(3000|5432|8001|8002|8003|8004|1984|80|443) ' | awk '{print $4}' | sort -u)
  local db_ok=$(docker exec camai-db pg_isready -U camai 2>/dev/null && echo "OK" || echo "FAIL")
  local app_errors=$(docker logs camai-app --since 10m 2>&1 | grep -iE 'error|fatal|crash|ENOSPC|killed' | tail -5)
  [ -z "$app_errors" ] && app_errors="No errors (10 min)"
  local docker_disk=$(docker system df --format 'table {{.Type}}\t{{.Size}}\t{{.Reclaimable}}' 2>/dev/null)
  local ext_disks=$(lsblk -o NAME,SIZE,MOUNTPOINT,FSTYPE 2>/dev/null | grep -vE 'loop|^NAME' | head -10)
  local net_info=$(ip -4 addr show 2>/dev/null | grep 'inet ' | grep -v 127.0.0.1 | awk '{print $NF": "$2}')

  cat <<EOF
$(echo -e '\xF0\x9F\x94\xA7') <b>DSS Debug Info</b>

<b>--- Git ---</b>
Branch: <code>${git_branch}</code>
Commit: <code>${git_commit}</code>
Date: ${git_date}

<b>--- DB ---</b>
PostgreSQL: ${db_ok}

<b>--- Ports ---</b>
<pre>${ports}</pre>

<b>--- Network ---</b>
<pre>${net_info}</pre>

<b>--- Disks ---</b>
<pre>${ext_disks}</pre>

<b>--- Docker Disk ---</b>
<pre>${docker_disk}</pre>

<b>--- Errors (10 min) ---</b>
<pre>${app_errors}</pre>

<b>--- Quick Commands ---</b>
<code>docker logs camai-app --tail 50</code>
<code>docker compose -f docker-compose.prod.yml restart cam-ai</code>
<code>docker exec camai-db psql -U camai camai</code>
EOF
}

echo "[tailscale-notify] Started. Checking every ${CHECK_INTERVAL}s..."

LAST_STATE="offline"
[ -f "$LAST_STATE_FILE" ] && LAST_STATE=$(cat "$LAST_STATE_FILE")

while true; do
  CURRENT_STATE="offline"
  if tailscale status > /dev/null 2>&1; then
    TS_STATE=$(tailscale status --json 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("BackendState",""))' 2>/dev/null)
    [ "$TS_STATE" = "Running" ] && CURRENT_STATE="online"
  fi

  if [ "$LAST_STATE" = "offline" ] && [ "$CURRENT_STATE" = "online" ]; then
    echo "[tailscale-notify] Online! Sending..."
    sleep 5
    send_telegram "$(get_msg_main)"
    sleep 2
    send_telegram "$(get_msg_debug)"
    echo "[tailscale-notify] Sent."
  fi

  [ "$LAST_STATE" = "online" ] && [ "$CURRENT_STATE" = "offline" ] && echo "[tailscale-notify] Went offline."

  LAST_STATE="$CURRENT_STATE"
  echo "$CURRENT_STATE" > "$LAST_STATE_FILE"
  sleep "$CHECK_INTERVAL"
done
