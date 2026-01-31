#!/bin/bash
set -e

echo ""
echo "[...] Обновление CamAI..."
echo ""

# Pull latest code (if using git)
if [ -d .git ]; then
    echo "[1/3] Обновление кода..."
    git pull
else
    echo "[1/3] Git не найден, пропуск..."
fi

# Rebuild
echo "[2/3] Сборка нового образа..."
docker compose build --quiet

# Restart
echo "[3/3] Перезапуск..."
docker compose down
docker compose up -d

echo ""
echo "[✓] CamAI обновлён и запущен на http://localhost:3000"
echo ""
