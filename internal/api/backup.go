package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"giftbook/internal/store"
)

const (
	backupFormat  = "giftbook-backup"
	backupVersion = 1
	maxBackupSize = 512 << 20
	maxZipEntries = 10000
	maxEntrySize  = 64 << 20
	maxTotalSize  = 512 << 20
)

// backupManifest 是备份包里的 manifest.json。
type backupManifest struct {
	Format    string `json:"format"`
	Version   int    `json:"version"`
	CreatedAt string `json:"createdAt"`
	App       string `json:"app"`
	Events    int    `json:"events"`
	Gifts     int    `json:"gifts"`
	HasAuth   bool   `json:"hasAuth"`
}

// ---- GET /api/backup 导出整库为 zip ----

func (s *Server) handleBackup(w http.ResponseWriter, r *http.Request) {
	events, gifts, err := s.store.BackupAll()
	if err != nil {
		fail(w, http.StatusInternalServerError, "备份失败：无法读取账簿数据")
		return
	}

	total := 0
	for _, items := range gifts {
		total += len(items)
	}
	manifest := backupManifest{
		Format:    backupFormat,
		Version:   backupVersion,
		CreatedAt: time.Now().Format("2006-01-02T15:04:05-07:00"),
		App:       s.buildLabel(),
		Events:    len(events),
		Gifts:     total,
		HasAuth:   s.auth.Enabled(),
	}

	filename := fmt.Sprintf("giftbook-backup-%s.zip", time.Now().Format("20060102-150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	zw := zip.NewWriter(w)
	writeJSONEntry := func(name string, value any) error {
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
	if err := writeJSONEntry("manifest.json", manifest); err != nil {
		return
	}
	if err := writeJSONEntry("data/events.json", events); err != nil {
		return
	}
	for id, items := range gifts {
		if err := writeJSONEntry("data/gifts_"+store.SanitizeID(id)+".json", items); err != nil {
			return
		}
	}
	// 访问保护状态随包备份，恢复后无需重新设置访问密码。
	if raw := s.auth.ExportState(); len(raw) > 0 {
		entry, err := zw.Create("config/auth-state.json")
		if err == nil {
			_, _ = entry.Write(raw)
		}
	}
	_ = zw.Close()
}

// ---- POST /api/backup 导入 zip ----

// parsedBackup 是解析并校验后的备份包内容。
type parsedBackup struct {
	manifest  backupManifest
	events    map[string]store.Record
	gifts     map[string]map[string]store.Record
	authState []byte
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
	if err := out.normalize(); err != nil {
		return nil, err
	}
	if len(out.authState) > 0 {
		if err := s.auth.ValidateState(out.authState); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// applyBackup 用校验过的数据整体替换现有账簿，并恢复访问保护状态。
func (s *Server) applyBackup(p *parsedBackup) (map[string]any, error) {
	if err := s.store.ReplaceAll(p.events, p.gifts); err != nil {
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
		"createdAt": p.manifest.CreatedAt,
		"hasAuth":   len(p.authState) > 0,
	}, nil
}

func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBackupSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, http.StatusRequestEntityTooLarge, "备份包过大或格式不正确")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		fail(w, http.StatusBadRequest, "请选择要导入的备份包")
		return
	}
	defer file.Close()

	// 先流式落到临时文件，再由 zip.Reader 按需读取；不把整个备份包攒进内存。
	tmp, err := os.CreateTemp("", "giftbook-restore-*.zip")
	if err != nil {
		fail(w, http.StatusInternalServerError, "无法处理备份包")
		return
	}
	defer os.Remove(tmp.Name())
	size, err := io.Copy(tmp, io.LimitReader(file, maxBackupSize+1))
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		fail(w, http.StatusBadRequest, "读取备份包失败")
		return
	}
	if size > maxBackupSize {
		fail(w, http.StatusRequestEntityTooLarge, "备份包过大")
		return
	}
	parsedFile, err := os.Open(tmp.Name())
	if err != nil {
		fail(w, http.StatusInternalServerError, "无法读取备份包")
		return
	}
	defer parsedFile.Close()
	parsed, err := s.parseBackupFile(parsedFile, size)
	if err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.applyBackup(parsed)
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	result["sourceName"] = header.Filename
	writeJSON(w, http.StatusOK, response{Success: true, Data: result})
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
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	event, ok := events[eventID]
	if !ok {
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
