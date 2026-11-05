package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"net/url"
	"time"

	"giftbook/internal/store"
)

const (
	backupFormat  = "giftbook-backup"
	backupVersion = 1
	maxBackupSize = 512 << 20
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

	buf, err := io.ReadAll(file)
	if err != nil {
		fail(w, http.StatusBadRequest, "读取备份包失败")
		return
	}
	reader, err := zip.NewReader(bytes.NewReader(buf), int64(len(buf)))
	if err != nil {
		fail(w, http.StatusBadRequest, "不是有效的备份包")
		return
	}

	var manifest backupManifest
	var events map[string]store.Record
	gifts := map[string]map[string]store.Record{}
	var authState []byte

	for _, entry := range reader.File {
		name := filepath.ToSlash(entry.Name)
		if strings.Contains(name, "..") {
			fail(w, http.StatusBadRequest, "备份包路径不合法")
			return
		}
		rc, err := entry.Open()
		if err != nil {
			fail(w, http.StatusBadRequest, "备份包内容损坏")
			return
		}
		content, err := io.ReadAll(io.LimitReader(rc, maxBackupSize))
		rc.Close()
		if err != nil {
			fail(w, http.StatusBadRequest, "备份包内容损坏")
			return
		}
		switch {
		case name == "manifest.json":
			if err := json.Unmarshal(content, &manifest); err != nil {
				fail(w, http.StatusBadRequest, "备份清单损坏")
				return
			}
		case name == "data/events.json":
			if err := json.Unmarshal(content, &events); err != nil {
				fail(w, http.StatusBadRequest, "账簿数据损坏")
				return
			}
		case strings.HasPrefix(name, "data/gifts_") && strings.HasSuffix(name, ".json"):
			id := strings.TrimSuffix(strings.TrimPrefix(name, "data/gifts_"), ".json")
			var items map[string]store.Record
			if err := json.Unmarshal(content, &items); err != nil {
				fail(w, http.StatusBadRequest, "礼金数据损坏")
				return
			}
			gifts[id] = items
		case name == "config/auth-state.json":
			authState = content
		}
	}

	if manifest.Format != backupFormat {
		fail(w, http.StatusBadRequest, "不是电子礼簿的备份包")
		return
	}
	if manifest.Version > backupVersion {
		fail(w, http.StatusBadRequest, "备份包来自更新版本，请先升级服务端")
		return
	}
	if events == nil {
		fail(w, http.StatusBadRequest, "备份包缺少账簿数据")
		return
	}
	// 校验每个账簿 ID 合法，并把缺失的礼金表补成空表。
	for id, event := range events {
		if !store.ValidID(id) {
			fail(w, http.StatusBadRequest, "备份包包含无效的账簿ID")
			return
		}
		if _, ok := event["id"]; !ok {
			event["id"] = id
		}
		if _, ok := gifts[id]; !ok {
			gifts[id] = map[string]store.Record{}
		}
	}
	// 丢掉没有对应账簿的礼金表，避免恢复后出现孤儿文件。
	for id := range gifts {
		if _, ok := events[id]; !ok {
			delete(gifts, id)
		}
	}

	if err := s.store.ReplaceAll(events, gifts); err != nil {
		fail(w, http.StatusInternalServerError, "导入失败："+err.Error())
		return
	}
	if len(authState) > 0 {
		_ = s.auth.ImportState(authState)
	}
	_ = header
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"events":     len(events),
		"gifts":      countGifts(gifts),
		"createdAt":  manifest.CreatedAt,
		"hasAuth":    len(authState) > 0,
		"sourceName": header.Filename,
	}})
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

// restoreZip 解析备份包并整体替换现有数据，返回恢复条数。
// 上传导入与从备份列表还原共用这条路径。
func (s *Server) restoreZip(data []byte) (map[string]any, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("不是有效的备份包")
	}
	var manifest backupManifest
	var events map[string]store.Record
	gifts := map[string]map[string]store.Record{}
	var authState []byte

	for _, entry := range reader.File {
		name := filepath.ToSlash(entry.Name)
		if strings.Contains(name, "..") {
			return nil, errors.New("备份包路径不合法")
		}
		rc, err := entry.Open()
		if err != nil {
			return nil, errors.New("备份包内容损坏")
		}
		content, err := io.ReadAll(io.LimitReader(rc, maxBackupSize))
		rc.Close()
		if err != nil {
			return nil, errors.New("备份包内容损坏")
		}
		switch {
		case name == "manifest.json":
			if err := json.Unmarshal(content, &manifest); err != nil {
				return nil, errors.New("备份清单损坏")
			}
		case name == "data/events.json":
			if err := json.Unmarshal(content, &events); err != nil {
				return nil, errors.New("账簿数据损坏")
			}
		case strings.HasPrefix(name, "data/gifts_") && strings.HasSuffix(name, ".json"):
			id := strings.TrimSuffix(strings.TrimPrefix(name, "data/gifts_"), ".json")
			var items map[string]store.Record
			if err := json.Unmarshal(content, &items); err != nil {
				return nil, errors.New("礼金数据损坏")
			}
			gifts[id] = items
		case name == "config/auth-state.json":
			authState = content
		}
	}
	if manifest.Format != backupFormat {
		return nil, errors.New("不是电子礼簿的备份包")
	}
	if manifest.Version > backupVersion {
		return nil, errors.New("备份包来自更新版本，请先升级服务端")
	}
	if events == nil {
		return nil, errors.New("备份包缺少账簿数据")
	}
	for id, event := range events {
		if !store.ValidID(id) {
			return nil, errors.New("备份包包含无效的账簿ID")
		}
		if _, ok := event["id"]; !ok {
			event["id"] = id
		}
		if _, ok := gifts[id]; !ok {
			gifts[id] = map[string]store.Record{}
		}
	}
	for id := range gifts {
		if _, ok := events[id]; !ok {
			delete(gifts, id)
		}
	}
	if err := s.store.ReplaceAll(events, gifts); err != nil {
		return nil, errors.New("导入失败：" + err.Error())
	}
	if len(authState) > 0 {
		_ = s.auth.ImportState(authState)
	}
	return map[string]any{
		"events":    len(events),
		"gifts":     countGifts(gifts),
		"createdAt": manifest.CreatedAt,
		"hasAuth":   len(authState) > 0,
	}, nil
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
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename*=UTF-8''`+urlEscape(filename))
	w.Header().Set("Cache-Control", "no-store")

	zw := zip.NewWriter(w)
	writeJSON := func(entry string, value any) error {
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
	_ = writeJSON("manifest.json", manifest)
	_ = writeJSON("data/events.json", map[string]store.Record{eventID: event})
	_ = writeJSON("data/gifts_"+store.SanitizeID(eventID)+".json", gifts)
	_ = zw.Close()
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
