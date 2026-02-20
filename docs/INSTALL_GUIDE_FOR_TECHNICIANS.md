# CamAI — Инструкция по установке для мастеров

## Требования к серверу
- **ОС**: Ubuntu 22.04 или 24.04 (ARM64 или x86_64)
- **RAM**: минимум 8 ГБ (рекомендуется 16 ГБ)
- **Диск**: минимум 64 ГБ (рекомендуется 128+ ГБ SSD/NVMe)
- **Сеть**: Ethernet-подключение к роутеру (интернет обязателен)
- **Камеры**: должны быть в одной сети с сервером

---

## Шаг 1. Подключить сервер к интернету

Подключите Ethernet-кабель от роутера к серверу.

Подключитесь к серверу по SSH (или через монитор + клавиатуру):
```bash
ssh user@<IP-сервера>
```

Проверьте что интернет работает:
```bash
ping -c 2 google.com
```

Если ответа нет — проверьте кабель и настройки сети.

---

## Шаг 2. Установить CamAI

Выполните одну команду:
```bash
curl -fsSL https://raw.githubusercontent.com/asilbektilavov/cam-ai/line-crossing/scripts/install.sh | sudo bash
```

Скрипт спросит:
- `GEMINI_API_KEY` — нажмите **Enter** (пропустить, настроит администратор позже)
- `TELEGRAM_BOT_TOKEN` — нажмите **Enter** (пропустить)

**Ожидание: 20-40 минут** (скачивание и сборка всех компонентов).

Скрипт автоматически:
- Установит Docker и Docker Compose (если не установлены)
- Установит Tailscale (для удалённого доступа)
- Склонирует проект в `/opt/camai`
- Сгенерирует секреты и SSL-сертификат
- Соберёт и запустит все Docker-контейнеры
- Настроит автозапуск при перезагрузке сервера (systemd)

После завершения вы увидите:
```
╔══════════════════════════════════════════════════════╗
║              CamAI установлен!                      ║
╚══════════════════════════════════════════════════════╝
```

---

## Шаг 3. Подключить удалённый доступ (Tailscale)

Выполните:
```bash
sudo tailscale up --ssh
```

Появится ссылка вида:
```
To authenticate, visit:

    https://login.tailscale.com/a/abc123def456
```

### Отправьте эту ссылку администратору (в Telegram или WhatsApp).

Дождитесь пока администратор подтвердит устройство (он откроет ссылку в браузере и авторизует сервер в своём Tailscale-аккаунте).

После подтверждения узнайте Tailscale IP:
```bash
tailscale ip -4
```

Покажет IP вида: `100.x.x.x`

### Отправьте этот IP администратору.

---

## Шаг 4. Настроить VNC (удалённый рабочий стол)

Если на сервере есть рабочий стол (GNOME/XFCE), установите VNC для удалённого доступа к экрану:

```bash
sudo apt-get install -y tigervnc-standalone-server tigervnc-tools xfce4 xfce4-terminal
```

Настройте VNC:
```bash
# Задать пароль для VNC (запомните его!)
sudo mkdir -p /root/.vnc
echo -e "camai123\ncamai123\nn" | sudo tigervncpasswd /root/.vnc/passwd

# Создать стартовый скрипт
sudo bash -c 'cat > /root/.vnc/xstartup << EOF
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
exec startxfce4
EOF
chmod +x /root/.vnc/xstartup'

# Запустить VNC-сервер
sudo vncserver :2 -geometry 1280x720 -depth 24 -localhost no
```

**Отправьте администратору**:
- VNC-порт: **5902**
- VNC-пароль: тот, что задали выше

Администратор подключится через: `vnc://100.x.x.x:5902` (через Tailscale)

---

## Шаг 5. Проверить работоспособность

```bash
sudo bash /opt/camai/scripts/manage.sh status
```

Вы должны увидеть 6 контейнеров в статусе `Up` или `healthy`:
- camai-app (веб-интерфейс)
- camai-db (база данных)
- camai-detector (детекция объектов)
- camai-attendance (распознавание лиц)
- camai-go2rtc (видеостриминг)
- camai-nginx (веб-сервер)

Также проверьте что веб-интерфейс открывается:
```bash
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3000
```
Должно показать: `HTTP 307` (редирект на страницу входа — это нормально)

---

## Шаг 6. Отправить данные администратору

Отправьте администратору (в Telegram или WhatsApp):

1. **Tailscale IP** — `100.x.x.x` (из шага 3)
2. **VNC-пароль** (из шага 4)
3. **Локальный IP сервера**:
   ```bash
   hostname -I | awk '{print $1}'
   ```
4. **IP-адреса камер** в локальной сети (если известны)

---

## Готово!

После этого администратор имеет полный удалённый доступ:

| Доступ | Адрес |
|---|---|
| **SSH** | `ssh user@100.x.x.x` (без пароля через Tailscale SSH) |
| **Веб-интерфейс CamAI** | `http://100.x.x.x:3000` |
| **Рабочий стол (VNC)** | `vnc://100.x.x.x:5902` |
| **Управление сервисами** | `sudo bash /opt/camai/scripts/manage.sh` |

При отключении питания сервисы CamAI автоматически перезапустятся после загрузки системы.

---

## Обновление CamAI

Когда администратор вносит изменения, он обновляет сервер удалённо:
```bash
sudo bash /opt/camai/scripts/manage.sh update
```
Или вручную:
```bash
cd /opt/camai
sudo git pull origin line-crossing
sudo docker compose -f docker-compose.prod.yml build cam-ai
sudo docker compose -f docker-compose.prod.yml up -d cam-ai
```

---

## При проблемах

### Посмотреть логи
```bash
# Все сервисы
sudo bash /opt/camai/scripts/manage.sh logs

# Конкретный сервис
sudo bash /opt/camai/scripts/manage.sh logs cam-ai
sudo bash /opt/camai/scripts/manage.sh logs detector
sudo bash /opt/camai/scripts/manage.sh logs attendance
```

### Перезапустить все сервисы
```bash
sudo bash /opt/camai/scripts/manage.sh restart
```

### Перезапустить один сервис
```bash
sudo bash /opt/camai/scripts/manage.sh restart cam-ai
```

### VNC не работает после перезагрузки
```bash
sudo vncserver :2 -geometry 1280x720 -depth 24 -localhost no
```

### Полная переустановка
```bash
sudo bash -c 'cd /opt/camai && docker compose -f docker-compose.prod.yml down -v && docker system prune -af'
sudo rm -rf /opt/camai
# Затем заново выполнить Шаг 2
```

### Сервер не имеет интернета
Без интернета установка невозможна. Убедитесь:
- Ethernet-кабель подключён к роутеру
- Роутер раздаёт интернет
- DNS работает: `ping google.com`

### Tailscale не подключается
```bash
sudo systemctl restart tailscaled
sudo tailscale up --ssh
```
