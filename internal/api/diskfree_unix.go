//go:build !windows

package api

import "syscall"

// diskFreeBytes 返回 path 所在文件系统的可用空间（字节）。
func diskFreeBytes(path string) (uint64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), nil
}
