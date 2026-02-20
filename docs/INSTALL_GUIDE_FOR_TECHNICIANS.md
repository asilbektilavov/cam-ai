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

Дождитесь пока администратор подтвердит устройство (он откроет ссылку в браузере).

После подтверждения узнайте Tailscale IP:
```bash
tailscale ip -4
```

Покажет IP вида: `100.x.x.x`

### Отправьте этот IP администратору.

---

## Шаг 4. Проверить работоспособность

```bash
sudo bash /opt/camai/scripts/manage.sh status
```

Вы должны увидеть 7 контейнеров в статусе `Up` или `healthy`:
- camai-app
- camai-db
- camai-detector
- camai-attendance
- camai-plate
- camai-go2rtc
- camai-nginx

Также проверьте что веб-интерфейс открывается:
```bash
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3000
```
Должно показать: `HTTP 200`

---

## Шаг 5. Отправить данные администратору

Отправьте администратору три вещи:

1. **Tailscale IP** — `100.x.x.x` (из шага 3)
2. **Локальный IP сервера**:
   ```bash
   hostname -I | awk '{print $1}'
   ```
3. **IP-адреса камер** в локальной сети (если известны)

---

## Готово!

После этого администратор имеет полный удалённый доступ:
- **SSH**: `ssh user@100.x.x.x`
- **Веб-интерфейс**: `http://100.x.x.x:3000`
- **Управление**: `sudo bash /opt/camai/scripts/manage.sh`

---

## При проблемах

### Посмотреть логи
```bash
sudo bash /opt/camai/scripts/manage.sh logs
```

### Перезапустить все сервисы
```bash
sudo bash /opt/camai/scripts/manage.sh restart
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
