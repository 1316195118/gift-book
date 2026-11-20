#!/bin/sh
# 启动入口：优先执行挂载卷里的可替换二进制（自更新落地点），
# 没有时回退到镜像内自带的二进制。这样自更新不需要改 compose。
set -e
if [ -x /config/giftbook ]; then
  echo "gift-book: 使用 /config/giftbook（自更新版本）" >&2
  exec /config/giftbook "$@"
fi
echo "gift-book: 使用镜像内置二进制" >&2
exec /usr/local/bin/giftbook "$@"
