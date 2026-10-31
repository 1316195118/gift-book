#!/bin/sh
# 容器启动：把 www-data 的 UID/GID 对齐到宿主机，再把数据目录交还给它。
# 这样 NAS 上挂载出来的 data/ 不会变成 root 拥有、宿主机也删不掉。
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${GIFTBOOK_DATA_DIR:-/var/www/html/data}"
CONFIG_DIR="${GIFTBOOK_CONFIG_DIR:-/var/www/html/config}"

if [ "$(id -u)" = "0" ]; then
  if [ "$(id -g www-data)" != "$PGID" ]; then
    groupmod -o -g "$PGID" www-data 2>/dev/null || true
  fi
  if [ "$(id -u www-data)" != "$PUID" ]; then
    usermod -o -u "$PUID" www-data 2>/dev/null || true
  fi
  mkdir -p "$DATA_DIR" "$CONFIG_DIR"
  chown -R www-data:www-data "$DATA_DIR" "$CONFIG_DIR" 2>/dev/null || true
  chmod 775 "$DATA_DIR" "$CONFIG_DIR" 2>/dev/null || true
fi

exec apache2-foreground
