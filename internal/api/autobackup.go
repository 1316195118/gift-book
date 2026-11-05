package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"giftbook/internal/backup"
)

// 自动备份设置，保存在配置目录 autobackup.json。
type autoBackupConfig struct {
	Enabled   bool `json:"enabled"`
	IntervalH int  `json:"intervalHours"` // 1 / 6 / 12 / 24 / 168
	Keep      int  `json:"keep"`          // 保留最近 N 份
}

func (s *Server) autoBackupPath() string {
	dir := s.configDir
	if dir == "" {
		dir = s.store.Dir()
	}
	return filepath.Join(dir, "autobackup.json")
}

func (s *Server) loadAutoBackup() autoBackupConfig {
	cfg := autoBackupConfig{Enabled: false, IntervalH: 24, Keep: 14}
	raw, err := os.ReadFile(s.autoBackupPath())
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(raw, &cfg)
	if cfg.IntervalH <= 0 {
		cfg.IntervalH = 24
	}
	if cfg.Keep <= 0 {
		cfg.Keep = 14
	}
	if cfg.Keep > 200 {
		cfg.Keep = 200
	}
	return cfg
}

func (s *Server) saveAutoBackup(cfg autoBackupConfig) error {
	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := s.autoBackupPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o775); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// runAutoBackup 生成一份自动备份，并按保留数量清理旧文件。
func (s *Server) runAutoBackup() error {
	data, _, err := backup.Build(s.store, s.buildLabel(), s.auth.Enabled(), s.auth.ExportState())
	if err != nil {
		return err
	}
	dir := filepath.Join(s.store.Dir(), "backups")
	if err := os.MkdirAll(dir, 0o775); err != nil {
		return err
	}
	name := "auto-" + time.Now().Format("20060102-150405") + ".zip"
	if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
		return err
	}
	cfg := s.loadAutoBackup()
	_, _ = backup.Prune(s.store.Dir(), cfg.Keep)
	s.lastBackupMu.Lock()
	s.lastBackupAt = time.Now()
	s.lastBackupErr = ""
	s.lastBackupMu.Unlock()
	return nil
}

// StartAutoBackup 按设置的间隔在后台定时备份。
func (s *Server) StartAutoBackup() {
	go func() {
		for {
			cfg := s.loadAutoBackup()
			if !cfg.Enabled {
				time.Sleep(time.Minute)
				continue
			}
			interval := time.Duration(cfg.IntervalH) * time.Hour
			last := s.lastBackupTime()
			if last.IsZero() {
				// 从未备份过：立刻做一份，避免刚开启就等一整天
				if err := s.runAutoBackup(); err != nil {
					s.lastBackupMu.Lock()
					s.lastBackupErr = err.Error()
					s.lastBackupMu.Unlock()
				}
				time.Sleep(time.Minute)
				continue
			}
			wait := interval - time.Since(last)
			if wait < time.Minute {
				wait = time.Minute
			}
			time.Sleep(wait)
			if err := s.runAutoBackup(); err != nil {
				s.lastBackupMu.Lock()
				s.lastBackupErr = err.Error()
				s.lastBackupMu.Unlock()
			}
		}
	}()
}

func (s *Server) lastBackupTime() time.Time {
	s.lastBackupMu.Lock()
	at := s.lastBackupAt
	s.lastBackupMu.Unlock()
	if !at.IsZero() {
		return at
	}
	// 进程重启后从文件时间推断
	items, err := backup.List(s.store.Dir())
	if err != nil || len(items) == 0 {
		return time.Time{}
	}
	return items[0].ModTime
}

// ---- 接口 ----

func (s *Server) handleAutoBackupGet(w http.ResponseWriter, r *http.Request) {
	cfg := s.loadAutoBackup()
	dir := s.store.Dir()
	items, _ := backup.List(dir)
	s.lastBackupMu.Lock()
	lastAt := s.lastBackupAt
	lastErr := s.lastBackupErr
	s.lastBackupMu.Unlock()
	if lastAt.IsZero() && len(items) > 0 {
		lastAt = items[0].ModTime
	}
	list := make([]map[string]any, 0, len(items))
	for i, item := range items {
		if i >= 20 {
			break
		}
		list = append(list, map[string]any{
			"name":    item.Name,
			"size":    item.Size,
			"modTime": item.ModTime.Format(time.RFC3339),
		})
	}
	var lastText string
	if !lastAt.IsZero() {
		lastText = lastAt.Format("2006-01-02 15:04")
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"enabled":       cfg.Enabled,
		"intervalHours": cfg.IntervalH,
		"keep":          cfg.Keep,
		"lastBackupAt":  lastText,
		"lastError":     lastErr,
		"dir":           filepath.Join(dir, "backups"),
		"files":         list,
	}})
}

func (s *Server) handleAutoBackupSave(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled       *bool `json:"enabled"`
		IntervalHours int   `json:"intervalHours"`
		Keep          int   `json:"keep"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Enabled == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	allowed := map[int]bool{1: true, 6: true, 12: true, 24: true, 168: true}
	interval := body.IntervalHours
	if !allowed[interval] {
		interval = 24
	}
	keep := body.Keep
	if keep < 1 {
		keep = 1
	}
	if keep > 200 {
		keep = 200
	}
	cfg := autoBackupConfig{Enabled: *body.Enabled, IntervalH: interval, Keep: keep}
	if err := s.saveAutoBackup(cfg); err != nil {
		fail(w, http.StatusInternalServerError, "保存设置失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"enabled": cfg.Enabled, "intervalHours": cfg.IntervalH, "keep": cfg.Keep,
	}})
}

func (s *Server) handleAutoBackupRun(w http.ResponseWriter, r *http.Request) {
	if err := s.runAutoBackup(); err != nil {
		fail(w, http.StatusInternalServerError, "备份失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true})
}

func (s *Server) handleAutoBackupDownload(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !strings.HasPrefix(name, "auto-") || !strings.HasSuffix(name, ".zip") || strings.Contains(name, "..") {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.store.Dir(), "backups", filepath.Base(name))
	data, err := os.ReadFile(path)
	if err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(name)+`"`)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

// 供路由注册使用

// ---- 备份文件操作 ----

// handleAutoBackupRestore 从数据目录里的备份文件还原整站数据。
func (s *Server) handleAutoBackupRestore(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !safeBackupName(name) {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.store.Dir(), "backups", filepath.Base(name))
	data, err := os.ReadFile(path)
	if err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	counts, err := s.restoreZip(data)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: counts})
}

// handleAutoBackupDelete 删除一份备份文件。
func (s *Server) handleAutoBackupDelete(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !safeBackupName(name) {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.store.Dir(), "backups", filepath.Base(name))
	if err := os.Remove(path); err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true})
}

// safeBackupName 只允许 backups 目录里由本程序生成的 zip。
func safeBackupName(name string) bool {
	if name == "" || strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
		return false
	}
	return strings.HasSuffix(name, ".zip")
}
