@echo off
rem 一键构建：写构建号 → 编译 Go 单文件可执行程序。
rem 前端 ui/ 为自研原生 JS/CSS，由 //go:embed all:ui 直接嵌入，无需 npm install / Vite 打包。
setlocal
cd /d "%~dp0"

node scripts\build.mjs
if errorlevel 1 (
  echo 构建失败，请查看上面的错误信息。
  exit /b 1
)
exit /b 0
