#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       CamAI — Установка              ║"
echo "║   Видеонаблюдение с ИИ-анализом      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "[!] Docker не найден. Установите Docker:"
    echo "    https://docs.docker.com/get-docker/"
    echo ""
    echo "    Для Ubuntu/Debian:"
    echo "    curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    echo "[!] Docker Compose не найден."
    echo "    Обновите Docker до последней версии."
    exit 1
fi

echo "[✓] Docker найден: $(docker --version)"
echo ""

# Get Gemini API key
if [ -z "$GEMINI_API_KEY" ]; then
    echo "Для работы ИИ-анализа нужен Gemini API ключ."
    echo "Получите бесплатно: https://aistudio.google.com/apikey"
    echo ""
    read -p "Введите Gemini API Key: " GEMINI_API_KEY
    echo ""
fi

if [ -z "$GEMINI_API_KEY" ]; then
    echo "[!] API ключ не указан. ИИ-анализ будет отключён."
    echo "    Можете добавить позже в .env файл."
    echo ""
fi

# Generate secret
NEXTAUTH_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "cam-ai-$(date +%s)-secret")

# Create .env
cat > .env << EOF
GEMINI_API_KEY=${GEMINI_API_KEY}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
EOF

echo "[✓] Конфигурация сохранена в .env"
echo ""

# Build and start
echo "[...] Сборка Docker образа (может занять несколько минут)..."
docker compose build --quiet

echo "[...] Запуск CamAI..."
docker compose up -d

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       CamAI установлен!              ║"
echo "╠══════════════════════════════════════╣"
echo "║                                      ║"
echo "║  Откройте в браузере:                ║"
echo "║  http://localhost:3000               ║"
echo "║                                      ║"
echo "║  Зарегистрируйте аккаунт и          ║"
echo "║  добавьте камеры.                    ║"
echo "║                                      ║"
echo "╠══════════════════════════════════════╣"
echo "║  Команды:                            ║"
echo "║  Стоп:    docker compose down        ║"
echo "║  Старт:   docker compose up -d       ║"
echo "║  Логи:    docker compose logs -f     ║"
echo "║  Обновить: ./update.sh               ║"
echo "╚══════════════════════════════════════╝"
echo ""
