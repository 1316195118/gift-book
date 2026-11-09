// Package backup 负责整站备份的打包，以及按计划自动备份到配置目录。
package backup

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"giftbook/internal/store"
)

// Format 与 Version 用于标识备份包。
const (
	Format  = "giftbook-backup"
	Version = 1
)

// Manifest 是备份包里的 manifest.json。
type Manifest struct {
	Format    string `json:"format"`
	Version   int    `json:"version"`
	CreatedAt string `json:"createdAt"`
	App       string `json:"app"`
	Events    int    `json:"events"`
	Gifts     int    `json:"gifts"`
	HasAuth   bool   `json:"hasAuth"`
}

// Write 把全部账簿以 zip 格式流式写入 w，内存占用与数据量无关。
// 服务端定时备份走这里，避免整库 zip 全部驻留内存。
func Write(w io.Writer, st *store.Store, buildLabel string, authEnabled bool, authState []byte) (Manifest, error) {
	events, gifts, err := st.BackupAll()
	if err != nil {
		return Manifest{}, fmt.Errorf("读取账簿失败: %w", err)
	}
	total := 0
	for _, items := range gifts {
		total += len(items)
	}
	manifest := Manifest{
		Format:    Format,
		Version:   Version,
		CreatedAt: time.Now().Format(time.RFC3339),
		App:       buildLabel,
		Events:    len(events),
		Gifts:     total,
		HasAuth:   authEnabled,
	}

	zw := zip.NewWriter(w)
	writeJSON := func(name string, value any) error {
		entry, err := zw.Create(name)
		if err != nil {
			return err
		}
		payload, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		_, err = entry.Write(payload)
		return err
	}
	if err := writeJSON("manifest.json", manifest); err != nil {
		return manifest, err
	}
	if err := writeJSON("data/events.json", events); err != nil {
		return manifest, err
	}
	ids := make([]string, 0, len(gifts))
	for id := range gifts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if err := writeJSON("data/gifts_"+store.SanitizeID(id)+".json", gifts[id]); err != nil {
			return manifest, err
		}
	}
	if len(authState) > 0 {
		entry, err := zw.Create("config/auth-state.json")
		if err != nil {
			return manifest, err
		}
		if _, err := entry.Write(authState); err != nil {
			return manifest, err
		}
	}
	if err := zw.Close(); err != nil {
		return manifest, err
	}
	return manifest, nil
}

// Build 生成 zip 字节流，供测试与需要内存缓冲的场景使用。
func Build(st *store.Store, buildLabel string, authEnabled bool, authState []byte) ([]byte, Manifest, error) {
	var buf bytes.Buffer
	manifest, err := Write(&buf, st, buildLabel, authEnabled, authState)
	if err != nil {
		return nil, manifest, err
	}
	return buf.Bytes(), manifest, nil
}

// Entry 是自动备份目录里的一个文件。
type Entry struct {
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// List 列出 dir/backups/ 下的自动备份（正常部署时 dir 为配置目录），最新的在前。
func List(dir string) ([]Entry, error) {
	path := filepath.Join(dir, "backups")
	items, err := os.ReadDir(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []Entry{}, nil
		}
		return nil, err
	}
	out := make([]Entry, 0, len(items))
	for _, item := range items {
		if item.IsDir() || !strings.HasSuffix(item.Name(), ".zip") {
			continue
		}
		info, err := item.Info()
		if err != nil {
			continue
		}
		out = append(out, Entry{Name: item.Name(), Size: info.Size(), ModTime: info.ModTime()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out, nil
}

// Prune 只保留 dir/backups/ 里最近 keep 个自动备份，返回删除的数量。
func Prune(dir string, keep int) (int, error) {
	if keep <= 0 {
		return 0, nil
	}
	items, err := List(dir)
	if err != nil {
		return 0, err
	}
	removed := 0
	for i, item := range items {
		if i < keep {
			continue
		}
		if err := os.Remove(filepath.Join(dir, "backups", item.Name)); err == nil {
			removed++
		}
	}
	return removed, nil
}
