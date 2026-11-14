// 隔离前端依赖目录：node_modules 里第三方包可能夹带 .go 文件，
// 没有这个模块边界时根模块的 go test ./... 会把它们一起扫进来。
module giftbook/web

go 1.22
