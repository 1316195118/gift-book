//go:build windows

package api

// diskFreeBytes 在 Windows 上不探测剩余空间（本机只做开发预览，正式部署在 Linux）。
// 返回 0 让前端隐藏这一项，而不是显示一个假的数字。
func diskFreeBytes(string) (uint64, error) { return 0, nil }
