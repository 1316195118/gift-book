#!/usr/bin/env bash
# 一键回滚：把 PVE / NAS 上的电子礼簿退回到指定版本。
#
# 用法：
#   GB_PW='<PVE root 密码>' NAS_PW='<NAS 账号密码>' scripts/rollback.sh v2.4.30
#   scripts/rollback.sh --nas ocr-v2.4.30          # 只回滚 NAS
#   scripts/rollback.sh --pve v2.4.30              # 只回滚 PVE
#
# 版本写法：vX.Y.Z 或 ocr-vX.Y.Z 都能识别，统一转成镜像标签 ocr-vX.Y.Z。
#
# 安全约束：
#   - 不碰 data / config 目录，只换程序本身；
#   - NAS 改 compose 前先备份原文件，校验失败自动还原；
#   - PVE 用 git archive 在临时目录按 tag 重建，不改当前工作区；
#   - 每一步都打印，回滚后核对 /api/build 返回的版本号。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

PVE_HOST="${PVE_HOST:-10.10.10.252}"
PVE_USER="${PVE_USER:-root}"
CT_ID="${CT_ID:-100}"
DOCKER_DIR="${DOCKER_DIR:-/opt/gift-book-docker}"
CONTAINER="${CONTAINER:-gift-book}"
NAS_HOST="${NAS_HOST:-10.10.10.253}"
NAS_USER="${NAS_USER:-test}"
NAS_COMPOSE="${NAS_COMPOSE:-/volume1/Compose/gift-book/docker-compose.yaml}"
NAS_URL="${NAS_URL:-http://10.10.10.253:8099}"
PVE_URL="${PVE_URL:-http://10.10.10.251:18099}"
REGISTRY="ghcr.io/1316195118/gift-book"

usage() {
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

TARGET="all"
raw="${1:-}"
[ $# -ge 1 ] || usage
case "$raw" in
  --nas) TARGET=nas; raw="${2:-}" ;;
  --pve) TARGET=pve; raw="${2:-}" ;;
esac
[ -n "$raw" ] || usage

version="${raw#ocr-}"
case "$version" in
  v[0-9]*) ;;
  *) echo "版本号应是 vX.Y.Z（如 v2.4.30）" >&2; exit 1 ;;
esac
image_tag="ocr-${version}"
git rev-parse -q --verify "refs/tags/${version}" >/dev/null || {
  echo "本地没有 tag ${version}；先 git fetch --tags" >&2; exit 1
}

echo "▸ 目标版本 ${version}（镜像 ${image_tag}），范围 ${TARGET}"

# ---------- 通用 SSH 助手 ----------
make_askpass() {
  local pw="$1"
  local dir
  dir="$(mktemp -d)"
  printf '#!/bin/sh\nprintf "%%s\\n" "$GB_PW"\n' > "$dir/askpass.sh"
  chmod +x "$dir/askpass.sh"
  echo "$dir/askpass.sh"
}

verify_version() {
  local url="$1" want="$2" got
  got="$(curl -s --noproxy '*' -m 10 "$url/api/build" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')" || true
  echo "   实际版本：${got:-无响应}"
  [ "$got" = "$want" ]
}

# ---------- NAS：改镜像标签，失败自动还原 ----------
rollback_nas() {
  [ -n "${NAS_PW:-}" ] || { echo "回滚 NAS 需要 NAS_PW" >&2; return 1; }
  local ask
  ask="$(make_askpass "$NAS_PW")"
  export SSH_ASKPASS="$ask" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
  local opts=(-o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=15)

  echo "▸ NAS：备份 compose → 切到 ${image_tag} → 校验"
  # 远端脚本先 base64 落到 /tmp，再用 printf 把 sudo 密码喂给 sudo -S。
  # SSH 自身认证走 askpass，stdin 只留给 sudo，不和脚本内容争用。
  local script payload
  script=$(cat <<'REMOTE'
set -e
cd "$(dirname "$COMPOSE")"
cp "$COMPOSE" "${COMPOSE}.rollback-bak"
rollback() {
  echo "  ! 校验失败，还原原 compose"
  cp "${COMPOSE}.rollback-bak" "$COMPOSE"
  docker compose up -d --force-recreate >/dev/null 2>&1 || true
}
trap rollback ERR
sed -i -E "s|image: ${REG}:ocr-v[0-9.]+|image: ${REG}:${TAG}|" "$COMPOSE"
grep -n 'image:' "$COMPOSE" | head -1
for i in 1 2 3 4; do docker compose pull >/dev/null 2>&1 && break; echo "  pull retry $i"; sleep 5; done
docker compose up -d --force-recreate >/dev/null
sleep 7
got="$(curl -s http://127.0.0.1:8099/api/build 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')" || true
echo "  NAS 实际版本：${got:-无响应}"
[ "$got" = "$WANT" ]
trap - ERR
rm -f "${COMPOSE}.rollback-bak"
echo "  ✓ NAS 已回滚到 $WANT"
REMOTE
)
  payload="$(printf '%s' "$script" | base64 | tr -d '\n')"
  ssh "${opts[@]}" "$NAS_USER@$NAS_HOST"     "PAYLOAD='$payload' PW='$NAS_PW' WANT='$version' COMPOSE='$NAS_COMPOSE' REG='$REGISTRY' TAG='$image_tag'; printf '%s' "\$PAYLOAD" | base64 -d > /tmp/gb-rollback.sh; printf '%s\n' "\$PW" | sudo -S -p '' bash /tmp/gb-rollback.sh; rc=\$?; rm -f /tmp/gb-rollback.sh; exit \$rc" || return 1
}

# ---------- PVE：从 git tag 在临时目录重建二进制 ----------
rollback_pve() {
  [ -n "${GB_PW:-}" ] || { echo "回滚 PVE 需要 GB_PW" >&2; return 1; }
  local tmp ask
  tmp="$(mktemp -d)"
  echo "▸ PVE：从 tag ${version} 在临时目录重建（不动工作区）"
  git archive "$version" | tar -x -C "$tmp"
  ln -s "$(pwd)/web/node_modules" "$tmp/web/node_modules"
  (
    cd "$tmp"
    export PATH="/c/Program Files/nodejs:/c/Program Files/Go/bin:$PATH"
    node scripts/build.mjs >/dev/null
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o giftbook-linux ./cmd/giftbook
  )

  ask="$(make_askpass "$GB_PW")"
  export SSH_ASKPASS="$ask" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}"
  local opts=(-o StrictHostKeyChecking=no -o ConnectTimeout=15)
  echo "▸ 上传到 PVE 并替换容器二进制"
  scp "${opts[@]}" "$tmp/giftbook-linux" "$PVE_USER@$PVE_HOST:/tmp/giftbook.rollback"
  ssh "${opts[@]}" "$PVE_USER@$PVE_HOST" \
    "CT_ID='$CT_ID' DOCKER_DIR='$DOCKER_DIR' CONTAINER='$CONTAINER' bash -s" <<'REMOTE'
set -e
if pct exec "$CT_ID" -- docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  pct exec "$CT_ID" -- sh -c "cd '$DOCKER_DIR' && docker compose down"
  pct push "$CT_ID" /tmp/giftbook.rollback "$DOCKER_DIR/giftbook" --perms 0755
  pct exec "$CT_ID" -- sh -c "cd '$DOCKER_DIR' && docker compose up -d"
else
  echo "PVE 当前不是容器部署，请手工替换二进制" >&2
  exit 1
fi
rm -f /tmp/giftbook.rollback
REMOTE
  rm -rf "$tmp"
  echo "  ✓ PVE 二进制已替换为 ${version}"
}

case "$TARGET" in
  nas) rollback_nas ;;
  pve) rollback_pve ;;
  all) rollback_nas; rollback_pve ;;
esac

echo "▸ 核对版本"
[ "$TARGET" = pve ] || verify_version "$NAS_URL" "$version"
[ "$TARGET" = nas ] || verify_version "$PVE_URL" "$version"
echo "✓ 回滚完成：${version}"
