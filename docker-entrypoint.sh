#!/bin/sh
# 启动入口：在两个二进制里挑版本更高的执行。
#
#   /usr/local/bin/giftbook  镜像内置（随镜像升级）
#   /config/giftbook         容器内自更新写入（挂载卷，重启后仍在）
#
# 只做「谁新用谁」，避免两个方向的问题：
#   · 镜像升级后，旧的自更新二进制不该继续压着新镜像；
#   · 网页自更新后，新二进制不该被镜像里的旧版本盖掉。
set -e

IMAGE_BIN=/usr/local/bin/giftbook
CONFIG_BIN=/config/giftbook

version_of() {
  "$1" -version 2>/dev/null | awk '{print $2; exit}'
}

# ver_gt A B：A 严格大于 B 时返回 0。只比较点分数字，兼容 busybox awk。
ver_gt() {
  awk -v a="$1" -v b="$2" 'BEGIN{
    n = split(a, x, "."); m = split(b, y, ".");
    for (i = 1; i <= 3; i++) {
      xi = (i <= n ? x[i] + 0 : 0);
      yi = (i <= m ? y[i] + 0 : 0);
      if (xi > yi) exit 0;
      if (xi < yi) exit 1;
    }
    exit 1;
  }'
}

if [ ! -x "$CONFIG_BIN" ]; then
  exec "$IMAGE_BIN" "$@"
fi

IMG_VER="$(version_of "$IMAGE_BIN")"
CFG_VER="$(version_of "$CONFIG_BIN")"

if [ -n "$CFG_VER" ] && { [ -z "$IMG_VER" ] || ver_gt "$CFG_VER" "$IMG_VER"; }; then
  echo "gift-book: 使用 /config/giftbook（v$CFG_VER，自更新版本）" >&2
  exec "$CONFIG_BIN" "$@"
fi

echo "gift-book: 使用镜像内置二进制（v$IMG_VER）" >&2
exec "$IMAGE_BIN" "$@"
