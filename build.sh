#!/bin/sh
# 构建 Linux 单文件二进制（在 WSL / Linux 上执行）。
# 前端 ui/ 为自研原生 JS/CSS，直接嵌入，无需 npm install / Vite。
set -e
cd "$(dirname "$0")"

node scripts/build.mjs
echo "完成：giftbook（当前平台可执行文件，位于仓库根目录）"
