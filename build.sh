#!/bin/sh
# 构建 Linux 单文件二进制（在 WSL / Linux 上执行）。
set -e
cd "$(dirname "$0")"

if [ ! -d web/node_modules ]; then
  echo "安装前端依赖…"
  (cd web && npm install)
fi

node scripts/build.mjs
echo "完成：giftbook（Linux）与 giftbook.exe（Windows 由 build.bat 生成）"
