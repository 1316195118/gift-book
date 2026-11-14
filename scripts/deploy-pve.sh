#!/usr/bin/env bash
# 构建并更新 PVE 上那台测试机的电子礼簿。
#
#   用法：GB_PW='<root 密码>' scripts/deploy-pve.sh
#
# 路径：本机构建 → scp 到 PVE 宿主机 /tmp → pct push 进 100 号容器 → 重启服务。
# 密码只从环境变量读，不写进仓库。
set -euo pipefail

PVE_HOST="${PVE_HOST:?请设置 PVE_HOST，例如 PVE_HOST=192.168.1.10}"
PVE_USER="${PVE_USER:-root}"
CT_ID="${CT_ID:-100}"
APP_URL="${APP_URL:-}"
REMOTE_BIN="${REMOTE_BIN:-/opt/giftbook-go/giftbook}"
SERVICE="${SERVICE:-giftbook}"
# 容器化部署（优先）：compose 目录与容器名
DOCKER_DIR="${DOCKER_DIR:-/opt/gift-book-docker}"
CONTAINER="${CONTAINER:-gift-book}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

export PATH="/c/Program Files/nodejs:/c/Program Files/Go/bin:$PATH"

if [ -z "${GB_PW:-}" ]; then
  echo "缺少 GB_PW（PVE root 密码）" >&2
  exit 1
fi

# OpenSSH 的非交互密码入口
ask="$(mktemp -d)/askpass.sh"
printf '#!/bin/sh\nprintf "%%s\\n" "$GB_PW"\n' > "$ask"
chmod +x "$ask"
export SSH_ASKPASS="$ask" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=15)

# 1. 构建 Vue 3 前端 → webapp/dist（Go embed 目录）
echo "▸ 构建前端（npm run build）"
(cd web && npm run build)
rm -rf webapp/dist/*
mkdir -p webapp/dist
cp -r web/dist/. webapp/dist/
touch webapp/dist/.gitkeep
printf '{"build":"%s","version":"2.2.1"}\n' "$(date +%Y%m%d-%H%M)" > webapp/dist/build.json

# 2. Linux 二进制
echo "▸ 交叉编译 linux/amd64"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o build/giftbook-linux-amd64 ./cmd/giftbook

# 3. 上传
echo "▸ 上传到 $PVE_HOST"
scp "${SSH_OPTS[@]}" build/giftbook-linux-amd64 "$PVE_USER@$PVE_HOST:/tmp/giftbook.new"

# 4. 部署：优先走 Docker 容器；没有容器时回退旧的 systemd 方式
#    容器里二进制正在执行，直接覆盖会报 Text file busy，必须先 compose down。
echo "▸ 部署到 CT $CT_ID"
ssh "${SSH_OPTS[@]}" "$PVE_USER@$PVE_HOST" \
  "CT_ID='$CT_ID' DOCKER_DIR='$DOCKER_DIR' CONTAINER='$CONTAINER' REMOTE_BIN='$REMOTE_BIN' SERVICE='$SERVICE' bash -s" <<'REMOTE'
set -e
if pct exec "$CT_ID" -- docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "▸ Docker 容器部署（先停容器，避免 Text file busy）"
  pct exec "$CT_ID" -- sh -c "cd '$DOCKER_DIR' && docker compose down"
  pct push "$CT_ID" /tmp/giftbook.new "$DOCKER_DIR/giftbook" --perms 0755
  pct exec "$CT_ID" -- sh -c "cd '$DOCKER_DIR' && docker compose up -d"
  pct exec "$CT_ID" -- sh -c "docker inspect '$CONTAINER' --format '{{.State.Status}}'"
else
  echo "▸ systemd 部署（旧方式）"
  pct push "$CT_ID" /tmp/giftbook.new "$REMOTE_BIN.new" --perms 0755
  pct exec "$CT_ID" -- sh -c "mv '$REMOTE_BIN.new' '$REMOTE_BIN' && systemctl restart '$SERVICE' && sleep 1 && systemctl is-active '$SERVICE'"
fi
rm -f /tmp/giftbook.new
REMOTE

# 5. 确认（设了 APP_URL 才查）
if [ -n "$APP_URL" ]; then
  code="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$APP_URL" || true)"
  echo "▸ $APP_URL → HTTP $code"
  [ "$code" = "200" ] || { echo "服务没有正常响应" >&2; exit 1; }
fi
echo "✓ 已更新"
