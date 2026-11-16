package api

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"giftbook/internal/backup"
	"giftbook/internal/store"
)

const (
	backupFormat  = "giftbook-backup"
	backupVersion = 2
	maxBackupSize = 512 << 20
	maxZipEntries = 10000
	maxEntrySize  = 64 << 20
	maxTotalSize  = 512 << 20
)

// backupManifest 直接复用 backup.Manifest，避免两处结构漂移。
type backupManifest = backup.Manifest

// contentHash 计算备份文件的 sha256（测试里已有同名 sha256Hex(string)，这里换个名字避免冲突）。
func contentHash(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// ---- GET /api/backup 导出整库为 zip ----

// contentDisposition 生成下载头：纯 ASCII 文件名用 filename=，
// 含中文（家庭名）时用 RFC 5987 的 filename*=，两者不能混用。
func contentDisposition(filename string) string {
	for _, r := range filename {
		if r > 127 {
			return `attachment; filename*=UTF-8''` + urlEscape(filename)
		}
	}
	return `attachment; filename="` + filename + `"`
}

// writeZipToResponse 先把 zip 完整写到临时文件，打包成功后再回传。
// 直接往 ResponseWriter 写时，中途读文件失败已经发出了 200，
// 客户端只会拿到一个截断的 zip，还会以为备份成功。
// 返回 true 表示整包已生成并开始回传。
func (s *Server) writeZipToResponse(w http.ResponseWriter, r *http.Request, filename string, build func(out io.Writer) error) bool {
	// 优先放在数据目录：容器里的 /tmp 往往是内存盘，大备份会把它撑爆。
	tmp, err := os.CreateTemp(s.store.Dir(), ".export-*.zip.tmp")
	if err != nil {
		tmp, err = os.CreateTemp("", "giftbook-export-*.zip")
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "无法生成备份文件")
		return false
	}
	path := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(path)
	}()
	if err := build(tmp); err != nil {
		log.Printf("生成备份失败: %v", err)
		fail(w, http.StatusInternalServerError, "生成备份失败，请稍后重试")
		return false
	}
	if err := tmp.Sync(); err != nil {
		fail(w, http.StatusInternalServerError, "生成备份失败，请稍后重试")
		return false
	}
	info, err := tmp.Stat()
	if err != nil {
		fail(w, http.StatusInternalServerError, "生成备份失败，请稍后重试")
		return false
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		fail(w, http.StatusInternalServerError, "生成备份失败，请稍后重试")
		return false
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", contentDisposition(filename))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, filename, info.ModTime(), tmp)
	return true
}

func (s *Server) handleBackup(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	filename := fmt.Sprintf("giftbook-backup-%s.zip", time.Now().Format("20060102-150405"))
	// 与定时备份共用同一实现：带 manifest 计数与逐文件 sha256 校验和。
	s.writeZipToResponse(w, r, filename, func(out io.Writer) error {
		_, err := backup.Write(out, s.store, s.buildLabel(), s.auth.Enabled(), s.auth.ExportState())
		return err
	})
}

// ---- POST /api/backup 导入 zip ----

// parsedBackup 是解析并校验后的备份包内容。
type parsedBackup struct {
	manifest  backupManifest
	events    map[string]store.Record
	gifts     map[string]map[string]store.Record
	families  map[string]store.Record
	authState []byte
	checksums map[string]string
}

func (p *parsedBackup) accept(name string, content []byte) error {
	switch {
	case name == "manifest.json":
		if err := json.Unmarshal(content, &p.manifest); err != nil {
			return errors.New("备份清单损坏")
		}
	case name == "data/events.json":
		if err := json.Unmarshal(content, &p.events); err != nil {
			return errors.New("账簿数据损坏")
		}
	case name == "data/families.json":
		if err := json.Unmarshal(content, &p.families); err != nil {
			return errors.New("家庭数据损坏")
		}
	case strings.HasPrefix(name, "data/gifts_") && strings.HasSuffix(name, ".json"):
		id := strings.TrimSuffix(strings.TrimPrefix(name, "data/gifts_"), ".json")
		if !store.ValidID(id) {
			return errors.New("备份包包含无效的账簿ID")
		}
		var items map[string]store.Record
		if err := json.Unmarshal(content, &items); err != nil {
			return errors.New("礼金数据损坏")
		}
		if p.gifts == nil {
			p.gifts = map[string]map[string]store.Record{}
		}
		p.gifts[id] = items
	case name == "config/auth-state.json":
		p.authState = content
	}
	if p.checksums == nil {
		p.checksums = map[string]string{}
	}
	p.checksums[name] = contentHash(content)
	return nil
}

// normalize 校验结构并把每本账簿的 ID 与字段规范化，丢弃孤儿礼金表。
func (p *parsedBackup) normalize() error {
	if p.gifts == nil {
		p.gifts = map[string]map[string]store.Record{}
	}
	for id, event := range p.events {
		if !store.ValidID(id) {
			return errors.New("备份包包含无效的账簿ID")
		}
		if _, ok := event["id"]; !ok {
			event["id"] = id
		}
		if err := validateEventBody(event, nil); err != nil {
			return errors.New("账簿字段无效：" + err.Error())
		}
		if _, ok := p.gifts[id]; !ok {
			p.gifts[id] = map[string]store.Record{}
		}
	}
	for id := range p.gifts {
		if _, ok := p.events[id]; !ok {
			delete(p.gifts, id)
		}
	}
	for id := range p.families {
		if !store.ValidID(id) {
			return errors.New("备份包包含无效的家庭ID")
		}
	}
	if p.families != nil {
		if _, ok := p.families[store.DefaultFamilyID]; !ok {
			return errors.New("备份包缺少默认家庭")
		}
		// 账簿必须属于包里存在的家庭，否则还原后这些账簿对任何家庭都不可见，
		// 等于静默丢数据；这种情况只可能来自被改动或损坏的备份包。
		for _, event := range p.events {
			owner, _ := event["familyId"].(string)
			if owner == "" {
				continue
			}
			if _, exists := p.families[owner]; !exists {
				name, _ := event["name"].(string)
				return fmt.Errorf("备份包里的账簿「%s」属于不存在的家庭，无法还原", name)
			}
		}
	}
	for _, items := range p.gifts {
		for giftID, gift := range items {
			if !store.ValidID(giftID) {
				return errors.New("备份包包含无效的礼金ID")
			}
			if cipher, ok := gift["encryptedContent"]; ok {
				text, isString := cipher.(string)
				if !isString || validateCipher(text) != nil {
					return errors.New("备份包包含无效的加密内容")
				}
			}
		}
	}
	return nil
}

// parseBackupZip 解析内存里的备份包（测试与兼容入口）。
func (s *Server) parseBackupZip(data []byte) (*parsedBackup, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("不是有效的备份包")
	}
	return s.parseBackup(reader)
}

// parseBackupFile 从临时文件解析备份包，不把整个 zip 读进内存。
func (s *Server) parseBackupFile(r io.ReaderAt, size int64) (*parsedBackup, error) {
	reader, err := zip.NewReader(r, size)
	if err != nil {
		return nil, errors.New("不是有效的备份包")
	}
	return s.parseBackup(reader)
}

// parseBackup 校验备份包：限制条目数、单条大小与解压总量，
// 拒绝路径穿越，并在写入前校验账簿、礼金与访问保护状态。
func (s *Server) parseBackup(reader *zip.Reader) (*parsedBackup, error) {
	if len(reader.File) > maxZipEntries {
		return nil, errors.New("备份包条目过多")
	}
	out := &parsedBackup{}
	var total int64
	for _, entry := range reader.File {
		name := filepath.ToSlash(entry.Name)
		if strings.Contains(name, "..") || strings.HasPrefix(name, "/") {
			return nil, errors.New("备份包路径不合法")
		}
		if entry.FileInfo().IsDir() {
			continue
		}
		if entry.UncompressedSize64 > maxEntrySize {
			return nil, errors.New("备份包单个文件过大")
		}
		if entry.UncompressedSize64 > 0 {
			total += int64(entry.UncompressedSize64)
			if total > maxTotalSize {
				return nil, errors.New("备份包解压后过大")
			}
		}
		rc, err := entry.Open()
		if err != nil {
			return nil, errors.New("备份包内容损坏")
		}
		content, err := io.ReadAll(io.LimitReader(rc, maxEntrySize+1))
		rc.Close()
		if err != nil {
			return nil, errors.New("备份包内容损坏")
		}
		if int64(len(content)) > maxEntrySize {
			return nil, errors.New("备份包单个文件过大")
		}
		if err := out.accept(name, content); err != nil {
			return nil, err
		}
	}
	if out.manifest.Format != backupFormat {
		return nil, errors.New("不是电子礼簿的备份包")
	}
	if out.manifest.Version > backupVersion {
		return nil, errors.New("备份包来自更新版本，请先升级服务端")
	}
	if out.events == nil {
		return nil, errors.New("备份包缺少账簿数据")
	}
	// 逐文件校验和：能发现截断、位腐或被改动的备份包。
	if len(out.manifest.Checksums) > 0 {
		for name, want := range out.manifest.Checksums {
			if got := out.checksums[name]; got != want {
				return nil, fmt.Errorf("备份包校验失败：%s 与清单不一致", name)
			}
		}
	}
	// 数量核对：清单记录的总数必须与实际解析出的数量一致。
	actualGifts := 0
	for _, items := range out.gifts {
		actualGifts += len(items)
	}
	if out.manifest.Events > 0 && out.manifest.Events != len(out.events) {
		return nil, fmt.Errorf("备份包不完整：清单 %d 本账簿，实际 %d 本", out.manifest.Events, len(out.events))
	}
	if out.manifest.Gifts > 0 && out.manifest.Gifts != actualGifts {
		return nil, fmt.Errorf("备份包不完整：清单 %d 条礼金，实际 %d 条", out.manifest.Gifts, actualGifts)
	}
	if out.manifest.Families > 0 && out.manifest.Families != len(out.families) {
		return nil, fmt.Errorf("备份包不完整：清单 %d 个家庭，实际 %d 个", out.manifest.Families, len(out.families))
	}
	if err := out.normalize(); err != nil {
		return nil, err
	}
	if len(out.authState) > 0 {
		if err := s.auth.ValidateState(out.authState); err != nil {
			return nil, err
		}
		// 多个家庭却没有管理员密码，还原后任何人都能抢先把密码设成自己的，
		// 这种状态只可能来自被改过的备份包，直接拒绝。
		if len(out.families) > 1 {
			var state struct {
				Enabled bool `json:"enabled"`
			}
			if json.Unmarshal(out.authState, &state) == nil && !state.Enabled {
				return nil, errors.New("备份包含多个家庭但没有管理员密码，无法还原")
			}
		}
	}
	return out, nil
}

// applyBackup 用校验过的数据整体替换现有账簿，并恢复访问保护状态。
// 账簿、礼金与家庭清单走同一次切换，避免只成功一半导致账簿归属到不存在的家庭。
func (s *Server) applyBackup(p *parsedBackup) (map[string]any, error) {
	if err := s.store.ReplaceAllWithFamilies(p.events, p.gifts, p.families); err != nil {
		return nil, errors.New("导入失败：" + err.Error())
	}
	if len(p.authState) > 0 {
		if err := s.auth.ImportState(p.authState); err != nil {
			return nil, errors.New("访问保护状态导入失败：" + err.Error())
		}
	}
	return map[string]any{
		"events":    len(p.events),
		"gifts":     countGifts(p.gifts),
		"families":  len(p.families),
		"createdAt": p.manifest.CreatedAt,
		"hasAuth":   len(p.authState) > 0,
	}, nil
}

func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	parsed, filename, ok := s.readBackupUpload(w, r)
	if !ok {
		return
	}
	if parsed.manifest.Scope == "family" {
		fail(w, http.StatusBadRequest, "这是家庭备份，请在对应家庭的「家庭备份」里还原")
		return
	}
	result, err := s.applyBackup(parsed)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	result["sourceName"] = filename
	s.audit(r, "整站还原", "", filename)
	// 整站还原会影响所有家庭，必须通知全部在线页面刷新。
	s.notifyAllChange(r, "restore", "restored")
	writeJSON(w, http.StatusOK, response{Success: true, Data: result})
}

// readBackupUpload 读取上传的备份包并完成校验，失败时已写好响应。
func (s *Server) readBackupUpload(w http.ResponseWriter, r *http.Request) (*parsedBackup, string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBackupSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, http.StatusRequestEntityTooLarge, "备份包过大或格式不正确")
		return nil, "", false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, http.StatusBadRequest, "请选择要导入的备份包")
		return nil, "", false
	}
	defer file.Close()

	// 先流式落到临时文件，再由 zip.Reader 按需读取；不把整个备份包攒进内存。
	tmp, err := os.CreateTemp("", "giftbook-restore-*.zip")
	if err != nil {
		fail(w, http.StatusInternalServerError, "无法处理备份包")
		return nil, "", false
	}
	defer os.Remove(tmp.Name())
	size, err := io.Copy(tmp, io.LimitReader(file, maxBackupSize+1))
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		fail(w, http.StatusBadRequest, "读取备份包失败")
		return nil, "", false
	}
	if size > maxBackupSize {
		fail(w, http.StatusRequestEntityTooLarge, "备份包过大")
		return nil, "", false
	}
	parsedFile, err := os.Open(tmp.Name())
	if err != nil {
		fail(w, http.StatusInternalServerError, "无法读取备份包")
		return nil, "", false
	}
	defer parsedFile.Close()
	parsed, err := s.parseBackupFile(parsedFile, size)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return nil, "", false
	}
	return parsed, header.Filename, true
}

func countGifts(gifts map[string]map[string]store.Record) int {
	total := 0
	for _, items := range gifts {
		total += len(items)
	}
	return total
}

// ---- GET /api/backup/info 备份概况 ----

func (s *Server) handleBackupInfo(w http.ResponseWriter, r *http.Request) {
	if !s.requireGlobalBackup(w, r) {
		return
	}
	events, gifts, err := s.store.BackupAll()
	if err != nil {
		fail(w, http.StatusInternalServerError, "无法读取账簿数据")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"events": len(events),
		"gifts":  countGifts(gifts),
		"dir":    s.store.Dir(),
		"build":  s.buildLabel(),
		"authOn": s.auth.Enabled(),
	}})
}

// restoreBackupFile 解析数据目录里的备份文件并整体替换现有数据，返回恢复条数。
// 从备份列表还原走这条路径，同样不需要把 zip 全量读入内存。
func (s *Server) restoreBackupFile(path string) (map[string]any, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	parsed, err := s.parseBackupFile(f, info.Size())
	if err != nil {
		return nil, err
	}
	return s.applyBackup(parsed)
}

// handleExportEvent 导出单本账簿：账簿信息 + 该账簿的礼金密文。
// 与整站备份同一套 zip 结构，只含这一本，方便单独带走或归档。
func (s *Server) handleExportEvent(w http.ResponseWriter, r *http.Request, eventID string) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	event, exists := events[eventID]
	if !exists || !eventBelongsTo(event, family.ID) {
		fail(w, http.StatusNotFound, "事件不存在")
		return
	}
	if !s.requireLedgerKey(w, r, event) {
		return
	}
	gifts, err := s.store.ReadGifts(eventID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "礼金读取失败")
		return
	}

	name, _ := event["name"].(string)
	if name == "" {
		name = eventID
	}
	filename := sanitizeFilename(name) + ".zip"
	// 先在内存里把整包写完，任何一步失败都能正常回错误响应；
	// 单本账簿的数据量可控，避免直接往 ResponseWriter 写时出错却已发出 200。
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	writeEntry := func(entry string, value any) error {
		out, err := zw.Create(entry)
		if err != nil {
			return err
		}
		payload, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return err
		}
		_, err = out.Write(payload)
		return err
	}
	manifest := map[string]any{
		"format":    "giftbook-event",
		"version":   1,
		"createdAt": time.Now().Format(time.RFC3339),
		"app":       s.buildLabel(),
		"eventId":   eventID,
		"name":      name,
		"gifts":     len(gifts),
	}
	if err := writeEntry("manifest.json", manifest); err != nil {
		fail(w, http.StatusInternalServerError, "导出失败")
		return
	}
	if err := writeEntry("data/events.json", map[string]store.Record{eventID: event}); err != nil {
		fail(w, http.StatusInternalServerError, "导出失败")
		return
	}
	if err := writeEntry("data/gifts_"+store.SanitizeID(eventID)+".json", gifts); err != nil {
		fail(w, http.StatusInternalServerError, "导出失败")
		return
	}
	if err := zw.Close(); err != nil {
		fail(w, http.StatusInternalServerError, "导出失败")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename*=UTF-8''`+urlEscape(filename))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", itoa(buf.Len()))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// sanitizeFilename 去掉文件名里的非法字符。
func sanitizeFilename(name string) string {
	replaced := strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|', '\n', '\r', '\t':
			return '_'
		}
		return r
	}, name)
	replaced = strings.TrimSpace(replaced)
	if replaced == "" {
		return "ledger"
	}
	if len([]rune(replaced)) > 60 {
		replaced = string([]rune(replaced)[:60])
	}
	return replaced
}

func urlEscape(text string) string {
	return strings.ReplaceAll(url.QueryEscape(text), "+", "%20")
}
