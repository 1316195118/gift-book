// Package giftbook 把构建好的前端产物嵌入单一可执行文件。
package giftbook

import "embed"

//go:embed all:webapp/dist
var Assets embed.FS

// Dist 是前端产物在嵌入文件系统中的根目录。
const Dist = "webapp/dist"
