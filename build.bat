@echo off
rem 一键构建：前端（Vite）→ 嵌入目录 → Go 单文件可执行程序
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo 安装前端依赖...
  pushd web
  call npm install
  popd
)

node scripts\build.mjs
if errorlevel 1 (
  echo 构建失败，请查看上面的错误信息。
  exit /b 1
)
exit /b 0
