#!/usr/bin/env bash
#
# Secure Deploy — builds CamAI images, then removes source code from disk.
# Leaves only docker-compose.prod.yml + .env + nginx config on the server.
#
# Usage:  sudo bash /opt/camai/scripts/secure-deploy.sh [branch]
#
set -euo pipefail

BRANCH="${1:-line-crossing}"
REPO_URL="https://github.com/asilbektilavov/cam-ai.git"
DEPLOY_DIR="/opt/camai"
BUILD_DIR="/tmp/camai-build-$$"
COMPOSE_FILE="docker-compose.prod.yml"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
info() { echo -e "${GREEN}[*]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[X]${NC} $*" >&2; }

[[ $EUID -eq 0 ]] || { err "Run as root"; exit 1; }

info "Cloning fresh copy to $BUILD_DIR (branch: $BRANCH)..."
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$BUILD_DIR"

# Preserve existing .env and nginx/ssl
info "Preserving .env and SSL certificates..."
if [[ -f "$DEPLOY_DIR/.env" ]]; then
  cp "$DEPLOY_DIR/.env" "$BUILD_DIR/.env"
else
  warn ".env not found — first-time deploy requires install.sh first"
  rm -rf "$BUILD_DIR"
  exit 1
fi

if [[ -d "$DEPLOY_DIR/nginx/ssl" ]]; then
  cp -r "$DEPLOY_DIR/nginx/ssl" "$BUILD_DIR/nginx/"
fi

if [[ -d "$DEPLOY_DIR/protection" ]]; then
  # Preserve hardware fingerprint (critical — never rebuild it)
  cp -r "$DEPLOY_DIR/protection/.hw-lock" "$BUILD_DIR/protection/" 2>/dev/null || true
fi

info "Building Docker images (this takes 10-15 min on first run)..."
cd "$BUILD_DIR"
docker compose -f "$COMPOSE_FILE" build

info "Stopping old containers..."
cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true

info "Swapping deployment: keeping only runtime files..."
# Files/dirs to keep in /opt/camai — everything else is deleted
KEEP=(
  "docker-compose.prod.yml"
  "docker-compose.yml"
  ".env"
  "nginx"
  "scripts/secure-deploy.sh"
  "scripts/manage.sh"
)

# Stage new runtime files
STAGE_DIR="/tmp/camai-stage-$$"
mkdir -p "$STAGE_DIR"
for item in "${KEEP[@]}"; do
  if [[ -e "$BUILD_DIR/$item" ]]; then
    mkdir -p "$STAGE_DIR/$(dirname "$item")"
    cp -r "$BUILD_DIR/$item" "$STAGE_DIR/$(dirname "$item")/" 2>/dev/null || \
      cp "$BUILD_DIR/$item" "$STAGE_DIR/$item"
  fi
done

# Wipe and restore
rm -rf "$DEPLOY_DIR"/*
rm -rf "$DEPLOY_DIR"/.[!.]*  2>/dev/null || true
cp -r "$STAGE_DIR"/* "$DEPLOY_DIR/"
cp "$STAGE_DIR/.env" "$DEPLOY_DIR/.env" 2>/dev/null || true
chmod 600 "$DEPLOY_DIR/.env"

# Cleanup temp dirs
rm -rf "$BUILD_DIR" "$STAGE_DIR"

info "Starting containers with new image..."
cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" up -d

info "Pruning dangling images..."
docker image prune -f >/dev/null 2>&1 || true

echo ""
info "Deploy complete."
echo ""
echo "  /opt/camai contents (source code removed):"
ls -la "$DEPLOY_DIR"
echo ""
echo "  Docker images (compiled code inside):"
docker images | grep camai-
echo ""
warn "Source code is NOT on disk. For next update, run this script again."
warn "The compiled code stays inside Docker images, inaccessible via filesystem."
