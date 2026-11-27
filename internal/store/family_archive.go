package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// FamilyArchive 是「删除家庭」后留在 .trash/family-* 里的一份归档。
type FamilyArchive struct {
	Name       string `json:"name"`
	FamilyID   string `json:"familyId"`
	FamilyName string `json:"familyName"`
	ArchivedAt string `json:"archivedAt"`
	EventCount int    `json:"eventCount"`
	GiftFiles  int    `json:"giftFiles"`
}

func (s *Store) familyArchivePath(name string) (string, error) {
	if !strings.HasPrefix(name, "family-") || strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		return "", ErrNotFound
	}
	return filepath.Join(s.dir, ".trash", name), nil
}

// FamilyArchiveDir 返回归档目录的绝对路径，供接口在恢复前取走随归档保存的附加文件
// （例如该家庭的自动备份）。名称校验与恢复入口共用同一套规则。
func (s *Store) FamilyArchiveDir(name string) (string, error) {
	return s.familyArchivePath(name)
}

// ListFamilyArchives 列出已删除家庭的归档，按归档时间倒序。
func (s *Store) ListFamilyArchives() ([]FamilyArchive, error) {
	base := filepath.Join(s.dir, ".trash")
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return []FamilyArchive{}, nil
		}
		return nil, err
	}
	out := make([]FamilyArchive, 0)
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "family-") {
			continue
		}
		dir := filepath.Join(base, entry.Name())
		events, err := readMap(filepath.Join(dir, "events.json"))
		if err != nil || len(events) == 0 {
			continue
		}
		archive := FamilyArchive{Name: entry.Name(), EventCount: len(events)}
		if raw, err := os.ReadFile(filepath.Join(dir, "family.json")); err == nil {
			var meta struct {
				ID         string `json:"id"`
				Name       string `json:"name"`
				ArchivedAt string `json:"archivedAt"`
			}
			if json.Unmarshal(raw, &meta) == nil {
				archive.FamilyID = meta.ID
				archive.FamilyName = meta.Name
				archive.ArchivedAt = meta.ArchivedAt
			}
		}
		if archive.FamilyName == "" {
			// family-<名称>-<日期>-<时间>：去掉末尾两段时间。
			parts := strings.Split(strings.TrimPrefix(entry.Name(), "family-"), "-")
			if len(parts) > 2 {
				parts = parts[:len(parts)-2]
			}
			archive.FamilyName = strings.Join(parts, "-")
			if archive.FamilyName == "" {
				archive.FamilyName = "已删除家庭"
			}
		}
		if archive.ArchivedAt == "" {
			if info, err := entry.Info(); err == nil {
				archive.ArchivedAt = info.ModTime().Format("2006-01-02 15:04:05")
			}
		}
		files, _ := os.ReadDir(dir)
		for _, file := range files {
			if strings.HasPrefix(file.Name(), "gifts_") {
				archive.GiftFiles++
			}
		}
		out = append(out, archive)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ArchivedAt > out[j].ArchivedAt })
	return out, nil
}

// RestoreFamilyArchive 把一份家庭归档恢复成一个新的开放家庭。
// 原家庭 ID 若已被占用，会生成新的家庭 ID；账簿 ID 冲突时拒绝恢复。
func (s *Store) RestoreFamilyArchive(name string) (FamilyArchive, error) {
	// 恢复过程会搬动礼金文件（含失败回滚），统一在函数退出时清缓存。
	defer s.invalidateGiftCache()
	dir, err := s.familyArchivePath(name)
	if err != nil {
		return FamilyArchive{}, err
	}
	archived, err := readMap(filepath.Join(dir, "events.json"))
	if err != nil || len(archived) == 0 {
		return FamilyArchive{}, ErrNotFound
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	families, err := readMap(s.familiesPath())
	if err != nil {
		return FamilyArchive{}, err
	}
	current, err := readMap(s.eventsPath())
	if err != nil {
		return FamilyArchive{}, err
	}
	original := make(map[string]Record, len(current))
	for id, event := range current {
		original[id] = event
	}

	meta := FamilyArchive{Name: name, EventCount: len(archived)}
	if raw, readErr := os.ReadFile(filepath.Join(dir, "family.json")); readErr == nil {
		var stored struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			ArchivedAt string `json:"archivedAt"`
		}
		if json.Unmarshal(raw, &stored) == nil {
			meta.FamilyID = stored.ID
			meta.FamilyName = stored.Name
			meta.ArchivedAt = stored.ArchivedAt
		}
	}
	if meta.FamilyName == "" {
		meta.FamilyName = "已恢复家庭"
	}

	newID := meta.FamilyID
	if newID == "" || families[newID] != nil {
		newID = "fam_" + randomSuffix()
	}
	for {
		if families[newID] == nil {
			break
		}
		newID = "fam_" + randomSuffix()
	}

	ids := make([]string, 0, len(archived))
	for id, event := range archived {
		if _, conflict := current[id]; conflict {
			return FamilyArchive{}, errors.New("归档中的账簿编号与现有账簿冲突")
		}
		event["familyId"] = newID
		current[id] = event
		ids = append(ids, id)
	}
	sort.Strings(ids)

	moved := make([]string, 0, len(ids))
	for _, id := range ids {
		src := filepath.Join(dir, "gifts_"+SanitizeID(id)+".json")
		if _, statErr := os.Stat(src); statErr != nil {
			continue
		}
		if err := os.Rename(src, s.giftsPath(id)); err != nil {
			for _, back := range moved {
				_ = os.Rename(s.giftsPath(back), filepath.Join(dir, "gifts_"+SanitizeID(back)+".json"))
			}
			return FamilyArchive{}, err
		}
		moved = append(moved, id)
	}
	if err := writeJSON(s.eventsPath(), current); err != nil {
		for _, back := range moved {
			_ = os.Rename(s.giftsPath(back), filepath.Join(dir, "gifts_"+SanitizeID(back)+".json"))
		}
		return FamilyArchive{}, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	families[newID] = Record{
		"id":        newID,
		"name":      meta.FamilyName + "（已恢复）",
		"createdAt": now,
	}
	if err := writeJSON(s.familiesPath(), families); err != nil {
		// 家庭清单写失败：把账簿清单和礼金都放回去。
		_ = writeJSON(s.eventsPath(), original)
		for _, back := range moved {
			_ = os.Rename(s.giftsPath(back), filepath.Join(dir, "gifts_"+SanitizeID(back)+".json"))
		}
		return FamilyArchive{}, err
	}
	_ = os.RemoveAll(dir)
	meta.FamilyID = newID
	meta.FamilyName = meta.FamilyName + "（已恢复）"
	return meta, nil
}
