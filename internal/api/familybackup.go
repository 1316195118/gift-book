package api

import (
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"giftbook/internal/backup"
	"giftbook/internal/store"
)

// ---- GET /api/family/backup ----

// 家庭备份只含当前家庭的账簿与礼金密文，不含其他家庭，也不含管理员密码状态。
func (s *Server) handleFamilyBackup(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	filename := sanitizeFilename(family.Name) + "-backup-" + time.Now().Format("20060102-150405") + ".zip"
	done := s.writeZipToResponse(w, r, filename, func(out io.Writer) error {
		_, err := backup.WriteFamily(out, s.store, family.ID, family.Name, s.buildLabel())
		return err
	})
	if !done {
		return
	}
	// 只有整包生成成功才记「上次备份」：以前是边打包边写响应，
	// 中途失败也会把时间写成刚刚备份过。
	stamp := time.Now().Format("2006-01-02 15:04:05")
	_ = s.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		rec, exists := families[family.ID]
		if !exists {
			return false, nil
		}
		rec["lastBackupAt"] = stamp
		families[family.ID] = rec
		return true, nil
	})
}

// ---- POST /api/family/backup/restore ----

// 家庭还原只替换当前家庭的账簿，其他家庭原样保留；备份必须来自同一个家庭。
func (s *Server) handleFamilyRestore(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	// 先过二次验证再收文件：否则一个没通过验证的请求也能先上传几百 MB。
	if !s.requireFamilyRestore(w, r, family) {
		return
	}
	parsed, filename, ok := s.readBackupUpload(w, r)
	if !ok {
		return
	}
	if parsed.manifest.Scope != "family" {
		fail(w, http.StatusBadRequest, "请选择「家庭备份」文件；整站备份只能由管理员在「备份与恢复」里还原")
		return
	}
	if parsed.manifest.FamilyID != family.ID {
		fail(w, http.StatusBadRequest, "这份家庭备份属于其他家庭，不能在这里还原")
		return
	}
	for _, event := range parsed.events {
		event["familyId"] = family.ID
	}
	if err := s.store.ReplaceFamily(family.ID, parsed.events, parsed.gifts); err != nil {
		fail(w, http.StatusInternalServerError, "还原失败："+err.Error())
		return
	}
	s.audit(r, "家庭还原", family.Name, filename)
	s.notifyChange(r, "family-restore", "restored", "", "")
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"family":     family.Name,
		"events":     len(parsed.events),
		"gifts":      countGifts(parsed.gifts),
		"createdAt":  parsed.manifest.CreatedAt,
		"sourceName": filename,
	}})
}

// ---- 家庭级自动备份（服务器上的 auto-*.zip） ----

type familyBackupFile struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

func (s *Server) listFamilyAutoBackups(familyID string) []familyBackupFile {
	dir := filepath.Join(s.familyBackupsDir(), familyID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []familyBackupFile{}
	}
	out := make([]familyBackupFile, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !safeFamilyBackupName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out = append(out, familyBackupFile{
			Name: entry.Name(), Size: info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime > out[j].ModTime })
	return out
}

func safeFamilyBackupName(name string) bool {
	if !strings.HasPrefix(name, "auto-") || !strings.HasSuffix(name, ".zip") {
		return false
	}
	return !strings.Contains(name, "..") && !strings.ContainsAny(name, `/\`)
}

// moveAutoBackups 把家庭自动备份目录整体搬到 dst；dst 已有同名文件时逐个合并，
// 避免还原归档时因为目标目录已存在就整批放弃。src 不存在时直接返回 nil。
func moveAutoBackups(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(dst, 0o775); err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := os.Rename(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())); err != nil {
			return err
		}
	}
	return os.Remove(src)
}

// archiveFamilyBackups 把家庭自动备份目录搬进该家庭的归档里，返回新位置。
// 删除家庭后这些备份既不会再更新，也不会被任何清理逻辑带走，留在原处既占空间
// 又继续保存着账簿名称与密文，所以跟账簿一起归档。
func (s *Server) archiveFamilyBackups(familyID, trashName string) string {
	src := filepath.Join(s.familyBackupsDir(), familyID)
	if _, err := os.Stat(src); err != nil {
		return ""
	}
	var dst string
	if trashName != "" {
		dst = filepath.Join(s.store.Dir(), ".trash", trashName, "family-backups")
	} else {
		// 该家庭没有账簿、没有生成归档目录时，单独放到 .trash 下留待人工处理。
		dst = filepath.Join(s.store.Dir(), ".trash", "family-backups-"+time.Now().Format("20060102-150405")+"-"+familyID)
	}
	if err := moveAutoBackups(src, dst); err != nil {
		log.Printf("家庭备份目录归档失败，仍保留在原处: %v", err)
		return ""
	}
	return dst
}

func (s *Server) handleFamilyAutoBackups(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	cfg := s.loadAutoBackup()
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		// 家庭备份是整站定时任务的一部分：整站开关关掉时它们根本不会生成，
		// 所以对成员只报「实际会不会有备份」，同时把两个开关原样带回去供提示使用。
		"enabled":       cfg.Enabled && cfg.FamilyEnabled,
		"siteEnabled":   cfg.Enabled,
		"familyEnabled": cfg.FamilyEnabled,
		"keep":          cfg.FamilyKeep,
		"files":         s.listFamilyAutoBackups(family.ID),
	}})
}

func (s *Server) handleFamilyAutoBackupDownload(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	if !safeFamilyBackupName(name) {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.familyBackupsDir(), family.ID, name)
	f, err := os.Open(path)
	if err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(name)+`"`)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, filepath.Base(name), info.ModTime(), f)
}

func (s *Server) handleFamilyAutoBackupRestore(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	if !s.requireFamilyRestore(w, r, family) {
		return
	}
	name := r.PathValue("name")
	if !safeFamilyBackupName(name) {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.familyBackupsDir(), family.ID, name)
	f, err := os.Open(path)
	if err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	parsed, err := s.parseBackupFile(f, info.Size())
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	if parsed.manifest.Scope != "family" || parsed.manifest.FamilyID != family.ID {
		fail(w, http.StatusBadRequest, "这份自动备份不属于当前家庭")
		return
	}
	for _, event := range parsed.events {
		event["familyId"] = family.ID
	}
	if err := s.store.ReplaceFamily(family.ID, parsed.events, parsed.gifts); err != nil {
		fail(w, http.StatusInternalServerError, "还原失败："+err.Error())
		return
	}
	s.audit(r, "家庭自动备份还原", family.Name, name)
	s.notifyChange(r, "family-restore", "restored", "", "")
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"family": family.Name,
		"events": len(parsed.events),
		"gifts":  countGifts(parsed.gifts),
		"source": name,
	}})
}
