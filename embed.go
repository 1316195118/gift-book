// Package giftbook 把自研前端（零第三方依赖的原生 JS/CSS）嵌入单一可执行文件。
package giftbook

import "embed"

//go:embed all:ui
var Assets embed.FS

// Dist 是前端在嵌入文件系统中的根目录。
const Dist = "ui"
