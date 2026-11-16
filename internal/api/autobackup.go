package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"giftbook/internal/backup"
	"giftbook/internal/store"
)

// 自动备份设置，保存在配置目录 autobackup.json。
type autoBackupConfig struct {
	Enabled       bool `json:"enabled"`
	IntervalH     int  `json:"intervalHours"` // 1 / 6 / 12 / 24 / 168
	Keep          int  `json:"keep"`          // 整站备份保留最近 N 份
	FamilyEnabled bool `json:"familyEnabled"` // 同时为每个家庭单独备份
	FamilyKeep    int  `json:"familyKeep"`    // 每个家庭保留最近 N 份
}

func (s *Server) autoBackupPath() string {
	dir := s.configDir
	if dir == "" {
		dir = s.store.Dir()
	}
	return filepath.Join(dir, "autobackup.json")
}

// backupsRoot 是备份包目录的上一级：正常部署为配置目录，
// 单目录的测试环境回退到数据目录。backup.List / Prune 会在其下找 backups/。
func (s *Server) backupsRoot() string {
	dir := s.configDir
	if dir == "" {
		dir = s.store.Dir()
	}
	return dir
}

// backupsDir 是自动备份 zip 的实际存放目录。备份包不是账簿数据，
// 与 autobackup.json 一起放配置目录，data/ 里只留账簿 JSON 与 .trash/。
func (s *Server) backupsDir() string {
	return filepath.Join(s.backupsRoot(), "backups")
}

// familyBackupsDir 是家庭级自动备份的根目录：family-backups/<familyID>/auto-*.zip。
func (s *Server) familyBackupsDir() string {
	return filepath.Join(s.backupsRoot(), "family-backups")
}

func (s *Server) loadAutoBackup() autoBackupConfig {
	cfg := autoBackupConfig{Enabled: false, IntervalH: 24, Keep: 14, FamilyEnabled: true, FamilyKeep: 7}
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
	if cfg.FamilyKeep <= 0 {
		cfg.FamilyKeep = 7
	}
	if cfg.FamilyKeep > 200 {
		cfg.FamilyKeep = 200
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
	// 定时器与「立即备份一份」可能在同一秒触发，文件名按秒生成；
	// 必须串行，否则两个 goroutine 会同时写同一个 .tmp，产出损坏的 zip。
	s.backupMu.Lock()
	defer s.backupMu.Unlock()

	dir := s.backupsDir()
	if err := os.MkdirAll(dir, 0o775); err != nil {
		return err
	}
	name := "auto-" + time.Now().Format("20060102-150405") + ".zip"
	final := filepath.Join(dir, name)
	tmp := final + ".tmp"
	// 边打包边写临时文件，成功后原子改名；整个过程不把整库 zip 攒在内存里。
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = backup.Write(f, s.store, s.buildLabel(), s.auth.Enabled(), s.auth.ExportState())
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, final); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	cfg := s.loadAutoBackup()
	_, _ = backup.Prune(s.backupsRoot(), cfg.Keep)
	var familyErr error
	if cfg.FamilyEnabled {
		familyErr = s.runFamilyAutoBackups(cfg.FamilyKeep)
	}
	s.lastBackupMu.Lock()
	s.lastBackupAt = time.Now()
	if familyErr != nil {
		s.lastBackupErr = "整站备份完成，但家庭备份失败：" + familyErr.Error()
	} else {
		s.lastBackupErr = ""
	}
	s.lastBackupMu.Unlock()
	return nil
}

// StartAutoBackup 按设置的间隔在后台定时备份。
func (s *Server) StartAutoBackup() {
	s.autoBackupWG.Add(1)
	go func() {
		defer s.autoBackupWG.Done()
		for {
			select {
			case <-s.stopAutoBackup:
				return
			default:
			}
			cfg := s.loadAutoBackup()
			if !cfg.Enabled {
				if !s.sleepOrStop(time.Minute) {
					return
				}
				continue
			}
			interval := time.Duration(cfg.IntervalH) * time.Hour
			last := s.lastBackupTime()
			if last.IsZero() {
				// 从未备份过：立刻做一份，避免刚开启就等一整天
				if err := s.runAutoBackup(); err != nil {
					s.setLastBackupErr(err.Error())
				}
				if !s.sleepOrStop(time.Minute) {
					return
				}
				continue
			}
			wait := interval - time.Since(last)
			if wait <= 0 {
				if err := s.runAutoBackup(); err != nil {
					s.setLastBackupErr(err.Error())
				}
				// 失败时 lastBackupAt 不会更新，这里必须留出间隔，避免空转重试。
				wait = time.Minute
			}
			// 每次最多睡一分钟：管理员把 7 天改成 1 小时、或者直接关掉定时备份时，
			// 下一分钟就会生效，不用等完原来那段等待。
			if wait > time.Minute {
				wait = time.Minute
			}
			if !s.sleepOrStop(wait) {
				return
			}
		}
	}()
}

// sleepOrStop 等待指定时长，收到停止信号时返回 false，后台任务可及时退出。
func (s *Server) sleepOrStop(d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-s.stopAutoBackup:
		return false
	case <-timer.C:
		return true
	}
}

func (s *Server) setLastBackupErr(msg string) {
	s.lastBackupMu.Lock()
	s.lastBackupErr = msg
	s.lastBackupMu.Unlock()
}

// StopAutoBackup 停止后台定时备份，并等待正在执行的备份结束。
func (s *Server) StopAutoBackup() {
	s.stopOnce.Do(func() { close(s.stopAutoBackup) })
	s.autoBackupWG.Wait()
}

// backupAlert 给管理员的一句话提醒；空字符串表示自动备份看起来正常。
func (s *Server) backupAlert() string {
	s.lastBackupMu.Lock()
	lastErr := s.lastBackupErr
	s.lastBackupMu.Unlock()
	if lastErr != "" {
		return "自动备份失败：" + lastErr
	}
	cfg := s.loadAutoBackup()
	if !cfg.Enabled {
		return ""
	}
	interval := time.Duration(cfg.IntervalH) * time.Hour
	if interval <= 0 {
		return ""
	}
	last := s.lastBackupTime()
	if last.IsZero() || time.Since(last) <= interval*2 {
		return ""
	}
	return "自动备份已超过预计时间没有运行，请检查服务器状态"
}

// dirSize 递归统计目录占用；读不到的文件直接跳过。
func dirSize(path string) int64 {
	var total int64
	_ = filepath.WalkDir(path, func(_ string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		if info, infoErr := entry.Info(); infoErr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}

func (s *Server) lastBackupTime() time.Time {
	s.lastBackupMu.Lock()
	at := s.lastBackupAt
	s.lastBackupMu.Unlock()
	if !at.IsZero() {
		return at
	}
	// 进程重启后从文件时间推断
	items, err := backup.List(s.backupsRoot())
	if err != nil || len(items) == 0 {
		return time.Time{}
	}
	return items[0].ModTime
}

// ---- 接口 ----

func (s *Server) handleAutoBackupGet(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	cfg := s.loadAutoBackup()
	items, _ := backup.List(s.backupsRoot())
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
	totalBytes := int64(0)
	for _, item := range items {
		totalBytes += item.Size
	}
	familyBytes := dirSize(s.familyBackupsDir())
	diskFree, _ := diskFreeBytes(s.store.Dir())
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"enabled":       cfg.Enabled,
		"intervalHours": cfg.IntervalH,
		"keep":          cfg.Keep,
		"familyEnabled": cfg.FamilyEnabled,
		"familyKeep":    cfg.FamilyKeep,
		"lastBackupAt":  lastText,
		"lastError":     lastErr,
		"alert":         s.backupAlert(),
		"totalBytes":    totalBytes,
		"familyBytes":   familyBytes,
		"diskFree":      diskFree,
		"dir":           s.backupsDir(),
		"familyDir":     s.familyBackupsDir(),
		"files":         list,
	}})
}

func (s *Server) handleAutoBackupSave(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	var body struct {
		Enabled       *bool `json:"enabled"`
		IntervalHours int   `json:"intervalHours"`
		Keep          int   `json:"keep"`
		FamilyEnabled *bool `json:"familyEnabled"`
		FamilyKeep    int   `json:"familyKeep"`
	}
	if err := decodeJSON(w, r, &body); err != nil || body.Enabled == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	current := s.loadAutoBackup()
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
	familyEnabled := current.FamilyEnabled
	if body.FamilyEnabled != nil {
		familyEnabled = *body.FamilyEnabled
	}
	familyKeep := body.FamilyKeep
	if familyKeep < 1 {
		familyKeep = current.FamilyKeep
	}
	if familyKeep > 200 {
		familyKeep = 200
	}
	cfg := autoBackupConfig{
		Enabled: *body.Enabled, IntervalH: interval, Keep: keep,
		FamilyEnabled: familyEnabled, FamilyKeep: familyKeep,
	}
	if err := s.saveAutoBackup(cfg); err != nil {
		fail(w, http.StatusInternalServerError, "保存设置失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"enabled": cfg.Enabled, "intervalHours": cfg.IntervalH, "keep": cfg.Keep,
		"familyEnabled": cfg.FamilyEnabled, "familyKeep": cfg.FamilyKeep,
	}})
}

func (s *Server) handleAutoBackupRun(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	if err := s.runAutoBackup(); err != nil {
		fail(w, http.StatusInternalServerError, "备份失败："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true})
}

func (s *Server) handleAutoBackupDownload(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	name := r.PathValue("name")
	if !safeBackupName(name) {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.backupsDir(), filepath.Base(name))
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
	// 交给 ServeContent 流式回传，顺带支持 Range 与条件请求。
	http.ServeContent(w, r, filepath.Base(name), info.ModTime(), f)
}

// 供路由注册使用

// ---- 备份文件操作 ----

// handleAutoBackupRestore 从配置目录里的备份文件还原整站数据。
func (s *Server) handleAutoBackupRestore(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	name := r.PathValue("name")
	if !safeBackupName(name) {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.backupsDir(), filepath.Base(name))
	if _, err := os.Stat(path); err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	counts, err := s.restoreBackupFile(path)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit(r, "整站还原", "", "从自动备份 "+filepath.Base(name))
	// 自动备份是整站的：会替换全部家庭，必须通知所有在线页面刷新。
	s.notifyAllChange(r, "restore", "restored")
	writeJSON(w, http.StatusOK, response{Success: true, Data: counts})
}

// handleAutoBackupDelete 删除一份备份文件。
func (s *Server) handleAutoBackupDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	name := r.PathValue("name")
	if !safeBackupName(name) {
		fail(w, http.StatusBadRequest, "无效的备份文件")
		return
	}
	path := filepath.Join(s.backupsDir(), filepath.Base(name))
	if err := os.Remove(path); err != nil {
		fail(w, http.StatusNotFound, "备份文件不存在")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true})
}

// safeBackupName 只允许 backups 目录里由本程序生成的自动备份 zip。
// 下载、还原、删除三处共用同一套校验，避免接口之间口径不一致。
func safeBackupName(name string) bool {
	if !strings.HasPrefix(name, "auto-") || !strings.HasSuffix(name, ".zip") {
		return false
	}
	return !strings.Contains(name, "..") && !strings.ContainsAny(name, `/\`)
}

// ---- 家庭级自动备份 ----

// runFamilyAutoBackups 为每个家庭单独打一份包，并按 familyKeep 清理旧文件。
func (s *Server) runFamilyAutoBackups(keep int) error {
	families, err := s.store.ReadFamilies()
	if err != nil {
		return err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	updated := make([]string, 0, len(families))
	var firstErr error
	for id, rec := range families {
		family := familyFromRecord(id, rec)
		if family.Archived {
			continue
		}
		if err := s.writeFamilyAutoBackup(family, keep); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		updated = append(updated, id)
	}
	if len(updated) > 0 {
		_ = s.store.WithFamilies(func(current map[string]store.Record) (bool, error) {
			changed := false
			for _, id := range updated {
				rec, exists := current[id]
				if !exists {
					continue
				}
				rec["lastAutoBackupAt"] = now
				current[id] = rec
				changed = true
			}
			return changed, nil
		})
	}
	return firstErr
}

func (s *Server) writeFamilyAutoBackup(family familyInfo, keep int) error {
	dir := filepath.Join(s.familyBackupsDir(), family.ID)
	if err := os.MkdirAll(dir, 0o775); err != nil {
		return err
	}
	name := "auto-" + time.Now().Format("20060102-150405") + ".zip"
	final := filepath.Join(dir, name)
	tmp := final + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	_, err = backup.WriteFamily(f, s.store, family.ID, family.Name, s.buildLabel())
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, final); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	s.pruneFamilyBackups(dir, keep)
	return nil
}

// pruneFamilyBackups 只保留目录里最近 keep 个 auto-*.zip。
func (s *Server) pruneFamilyBackups(dir string, keep int) {
	if keep <= 0 {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type item struct {
		name string
		mod  time.Time
	}
	files := make([]item, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "auto-") || !strings.HasSuffix(entry.Name(), ".zip") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, item{entry.Name(), info.ModTime()})
	}
	if len(files) <= keep {
		return
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
	for _, old := range files[keep:] {
		_ = os.Remove(filepath.Join(dir, old.name))
	}
}
