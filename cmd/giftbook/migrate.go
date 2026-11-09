package main

import (
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// legacyDataDir 是 2.0 之前「所有文件都塞同一个目录」时的目录名。
const legacyDataDir = "rundata"

// migrateLegacyLayout 把旧 rundata/ 布局分派到新的 data/ + config/：
//
//	data/   只放账簿：events.json、gifts_*.json、.trash/
//	config/ 其余全部：访问保护状态、自动备份设置、backups/、其它非数据文件
//
// 三条硬规矩：只复制不删除、不覆盖已存在的文件、目标已有账簿数据就整体跳过。
// 必须在 store.Open 之前调用（那时 data/events.json 尚未被写入，判断才可靠）；
// 任何一步失败都只记日志，不阻断启动，旧数据原封不动留在 rundata/。
func migrateLegacyLayout(baseDir, dataDir, configDir string) {
	legacy := filepath.Join(baseDir, legacyDataDir)
	info, err := os.Stat(legacy)
	if err != nil || !info.IsDir() {
		return
	}
	if samePath(legacy, dataDir) || samePath(legacy, configDir) {
		return
	}
	// 目标已经有 events.json 就说明新布局已生效，绝不覆盖真实账簿。
	if _, err := os.Stat(filepath.Join(dataDir, "events.json")); err == nil {
		return
	}
	if err := os.MkdirAll(dataDir, 0o775); err != nil {
		log.Printf("旧目录迁移：无法创建数据目录 %s: %v", dataDir, err)
		return
	}
	if err := os.MkdirAll(configDir, 0o775); err != nil {
		log.Printf("旧目录迁移：无法创建配置目录 %s: %v", configDir, err)
		return
	}

	entries, err := os.ReadDir(legacy)
	if err != nil {
		log.Printf("旧目录迁移：无法读取 %s: %v", legacy, err)
		return
	}
	copied := 0
	for _, entry := range entries {
		name := entry.Name()
		src := filepath.Join(legacy, name)
		if entry.IsDir() {
			// .trash 属于账簿数据，其余目录（含 backups/）一律归配置目录。
			dst := filepath.Join(configDir, name)
			if name == ".trash" {
				dst = filepath.Join(dataDir, name)
			}
			n, err := copyTreeIfAbsent(src, dst)
			copied += n
			if err != nil {
				log.Printf("旧目录迁移：复制目录 %s 未完成: %v", src, err)
			}
			continue
		}
		dst := filepath.Join(configDir, name)
		if isLedgerFile(name) {
			dst = filepath.Join(dataDir, name)
		}
		ok, err := copyFileIfAbsent(src, dst)
		if ok {
			copied++
		}
		if err != nil {
			log.Printf("旧目录迁移：复制 %s 失败: %v", src, err)
		}
	}
	if copied > 0 {
		log.Printf("旧目录迁移完成：%s → data/ + config/，共复制 %d 个文件（原目录保留未动）", legacy, copied)
	}
}

// isLedgerFile 判断旧目录里的文件是否属于「账簿数据」。
// 其余（auth-*、autobackup.json、上传图片等）一律归到 config/。
func isLedgerFile(name string) bool {
	return name == "events.json" ||
		(strings.HasPrefix(name, "gifts_") && strings.HasSuffix(name, ".json"))
}

// copyFileIfAbsent 原子地复制单个文件；目标已存在就跳过，返回是否真的复制了。
func copyFileIfAbsent(src, dst string) (bool, error) {
	if _, err := os.Stat(dst); err == nil {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o775); err != nil {
		return false, err
	}
	in, err := os.Open(src)
	if err != nil {
		return false, err
	}
	defer in.Close()
	tmp := dst + ".migrate.tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return false, err
	}
	_, copyErr := io.Copy(out, in)
	if syncErr := out.Sync(); copyErr == nil {
		copyErr = syncErr
	}
	if closeErr := out.Close(); copyErr == nil {
		copyErr = closeErr
	}
	if copyErr != nil {
		_ = os.Remove(tmp)
		return false, copyErr
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return false, err
	}
	return true, nil
}

// copyTreeIfAbsent 递归复制目录，保留相对路径结构，不覆盖已有文件。
func copyTreeIfAbsent(src, dst string) (int, error) {
	count := 0
	err := filepath.WalkDir(src, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		ok, err := copyFileIfAbsent(path, filepath.Join(dst, rel))
		if ok {
			count++
		}
		return err
	})
	return count, err
}

// samePath 判断两个路径是否指向同一处（Windows 上大小写不敏感）。
func samePath(a, b string) bool {
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	if errA != nil || errB != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(absA), filepath.Clean(absB))
}
