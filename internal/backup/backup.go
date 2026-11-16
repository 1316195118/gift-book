// Package backup 负责整站备份的打包，以及按计划自动备份到配置目录。
package backup

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
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
	Version = 2
)

// Manifest 是备份包里的 manifest.json。
type Manifest struct {
	Format    string `json:"format"`
	Version   int    `json:"version"`
	CreatedAt string `json:"createdAt"`
	App       string `json:"app"`
	Events    int    `json:"events"`
	Gifts     int    `json:"gifts"`
	Families  int    `json:"families,omitempty"`
	HasAuth   bool   `json:"hasAuth"`
	// Scope 为空表示整站备份；family 表示只含一个家庭的家庭备份。
	Scope      string `json:"scope,omitempty"`
	FamilyID   string `json:"familyId,omitempty"`
	FamilyName string `json:"familyName,omitempty"`
	// Checksums 记录每个数据文件的 sha256（不含 manifest.json 自身），
	// 恢复时逐项比对，能发现截断、位腐或被改动的备份包。
	Checksums map[string]string `json:"checksums,omitempty"`
}

func sha256Hex(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// Write 把全部账簿以 zip 格式流式写入 w，内存占用与数据量无关。
// 服务端定时备份走这里，避免整库 zip 全部驻留内存。
func Write(w io.Writer, st *store.Store, buildLabel string, authEnabled bool, authState []byte) (Manifest, error) {
	events, gifts, err := st.BackupAll()
	if err != nil {
		return Manifest{}, fmt.Errorf("读取账簿失败: %w", err)
	}
	families, err := st.ReadFamilies()
	if err != nil {
		return Manifest{}, fmt.Errorf("读取家庭失败: %w", err)
	}
	return writeArchive(w, events, gifts, families, buildLabel, authEnabled, authState, "", "", "")
}

// WriteFamily 只打包指定家庭的账簿与礼金，不含管理员密码状态。
func WriteFamily(w io.Writer, st *store.Store, familyID, familyName, buildLabel string) (Manifest, error) {
	events, gifts, err := st.BackupFamily(familyID)
	if err != nil {
		return Manifest{}, fmt.Errorf("读取家庭账簿失败: %w", err)
	}
	return writeArchive(w, events, gifts, nil, buildLabel, false, nil, "family", familyID, familyName)
}

func writeArchive(w io.Writer, events map[string]store.Record, gifts map[string]map[string]store.Record, families map[string]store.Record, buildLabel string, authEnabled bool, authState []byte, scope, familyID, familyName string) (Manifest, error) {
	total := 0
	for _, items := range gifts {
		total += len(items)
	}
	// 先把全部数据文件序列化并算校验和，再写 manifest，最后写文件；
	// 这样清单里的 checksums 与包内内容严格一致，恢复时可逐项比对。
	type archiveFile struct {
		name    string
		payload []byte
	}
	files := make([]archiveFile, 0, len(gifts)+2)
	eventsPayload, err := json.MarshalIndent(events, "", "  ")
	if err != nil {
		return Manifest{}, err
	}
	files = append(files, archiveFile{"data/events.json", eventsPayload})
	if len(families) > 0 {
		familiesPayload, err := json.MarshalIndent(families, "", "  ")
		if err != nil {
			return Manifest{}, err
		}
		files = append(files, archiveFile{"data/families.json", familiesPayload})
	}
	ids := make([]string, 0, len(gifts))
	for id := range gifts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		payload, err := json.MarshalIndent(gifts[id], "", "  ")
		if err != nil {
			return Manifest{}, err
		}
		files = append(files, archiveFile{"data/gifts_" + store.SanitizeID(id) + ".json", payload})
	}
	checksums := make(map[string]string, len(files)+1)
	for _, f := range files {
		checksums[f.name] = sha256Hex(f.payload)
	}
	if len(authState) > 0 {
		checksums["config/auth-state.json"] = sha256Hex(authState)
	}

	manifest := Manifest{
		Format:     Format,
		Version:    Version,
		CreatedAt:  time.Now().Format(time.RFC3339),
		App:        buildLabel,
		Events:     len(events),
		Gifts:      total,
		Families:   len(families),
		HasAuth:    authEnabled,
		Scope:      scope,
		FamilyID:   familyID,
		FamilyName: familyName,
		Checksums:  checksums,
	}

	zw := zip.NewWriter(w)
	writeEntry := func(name string, payload []byte) error {
		entry, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = entry.Write(payload)
		return err
	}
	manifestPayload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return Manifest{}, err
	}
	if err := writeEntry("manifest.json", manifestPayload); err != nil {
		return manifest, err
	}
	for _, f := range files {
		if err := writeEntry(f.name, f.payload); err != nil {
			return manifest, err
		}
	}
	if len(authState) > 0 {
		if err := writeEntry("config/auth-state.json", authState); err != nil {
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
