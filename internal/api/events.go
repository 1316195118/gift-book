package api

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"giftbook/internal/ledger"
	"giftbook/internal/store"
)

// eventIDPattern 与旧版一致：字母数字下划线横线，1-64 位。
var eventIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// extraFields 是创建/修改账簿时可直接透传的字段白名单。
var extraFields = []string{
	"theme", "voiceName", "voiceEnabled", "coverImage", "startDateTime", "endDateTime",
	"minSpeechAmount", "qrcode", "template", "category", "location", "note",
	"totalAmount", "coverStyle",
}

// ---- GET /api/events ----

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	// 补齐历史账簿缺失的编号（只补缺失的，按创建时间排序）。
	if changed := s.backfillDisplayIDs(events); changed {
		if err := s.store.WithEvents(func(current map[string]store.Record) (bool, error) {
			for id, updated := range events {
				current[id] = updated
			}
			return true, nil
		}); err != nil {
			fail(w, http.StatusInternalServerError, "账簿升级保存失败")
			return
		}
	}
	out := make(map[string]map[string]any, len(events))
	for id, event := range events {
		public := ledger.Public(event)
		public["giftCount"] = s.store.CountGifts(id)
		out[id] = public
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: out})
}

// backfillDisplayIDs 给缺少合法编号的账簿补号，返回是否有改动。
func (s *Server) backfillDisplayIDs(events map[string]store.Record) bool {
	maxID := 0
	type missing struct {
		id      string
		created string
	}
	var pending []missing
	for id, event := range events {
		display, _ := event["displayId"].(string)
		if len(display) == 3 && isDigits(display) {
			if n, _ := strconv.Atoi(display); n > maxID {
				maxID = n
			}
		} else {
			created, _ := event["createdAt"].(string)
			pending = append(pending, missing{id: id, created: created})
		}
	}
	if len(pending) == 0 {
		return false
	}
	// 按创建时间升序（账簿数量很小，上限 999）。
	for i := 1; i < len(pending); i++ {
		for j := i; j > 0 && pending[j].created < pending[j-1].created; j-- {
			pending[j], pending[j-1] = pending[j-1], pending[j]
		}
	}
	changed := false
	for _, item := range pending {
		next := nextDisplayID(maxID)
		if next > 999 {
			break
		}
		maxID = next
		events[item.id]["displayId"] = pad3(next)
		events[item.id]["updatedAt"] = nowStamp()
		changed = true
	}
	return changed
}

func isDigits(text string) bool {
	for _, r := range text {
		if r < '0' || r > '9' {
			return false
		}
	}
	return text != ""
}

func pad3(n int) string {
	text := strconv.Itoa(n)
	for len(text) < 3 {
		text = "0" + text
	}
	return text
}

// ---- GET /api/events/{id} ----

func (s *Server) handleGetEvent(w http.ResponseWriter, r *http.Request, id string) {
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	event, ok := events[id]
	if !ok {
		fail(w, http.StatusNotFound, "事件不存在")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: ledger.Public(event)})
}

// ---- POST /api/events ----

func (s *Server) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	name, _ := body["name"].(string)
	hash, hasHash := body["passwordHash"].(string)
	if name == "" || !hasHash {
		fail(w, http.StatusBadRequest, "缺少必要参数")
		return
	}
	if err := validateEventBody(body, nil); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	newKey, ok := ledger.NormalizeKey(hash)
	if !ok {
		fail(w, http.StatusBadRequest, "无效的密码摘要")
		return
	}

	var created map[string]any
	var statusErr string
	err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		maxID := 0
		for _, existing := range events {
			display, _ := existing["displayId"].(string)
			if len(display) == 3 && isDigits(display) {
				if n, _ := strconv.Atoi(display); n > maxID {
					maxID = n
				}
			}
		}
		next := nextDisplayID(maxID)
		if next > 999 {
			statusErr = "账簿编号已用完（最多 999 本）"
			return false, errors.New(statusErr)
		}
		stamp := nowStamp()
		event := map[string]any{
			"id":        store.NewID(),
			"name":      name,
			"displayId": pad3(next),
			"createdAt": stamp,
			"updatedAt": stamp,
		}
		for k, v := range ledger.VerifierFields(newKey) {
			event[k] = v
		}
		for _, field := range append([]string{"kdf"}, extraFields...) {
			if value, ok := body[field]; ok {
				event[field] = value
			}
		}
		events[event["id"].(string)] = event
		created = event
		return true, nil
	})
	if err != nil {
		if statusErr != "" {
			fail(w, http.StatusConflict, statusErr)
			return
		}
		fail(w, http.StatusInternalServerError, "保存失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: ledger.Public(created)})
}

// ---- PUT /api/events/{id} ----

func (s *Server) handleUpdateEvent(w http.ResponseWriter, r *http.Request, id string) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	var updated map[string]any
	var status int
	var message string
	err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event, ok := events[id]
		if !ok {
			status, message = http.StatusNotFound, "事件不存在"
			return false, errors.New(message)
		}
		if !s.requireLedgerKey(w, r, event) {
			status = -1 // 已写出响应
			return false, errors.New("ledger key rejected")
		}
		delete(body, "passwordHash")
		if _, hasKDF := event["kdf"]; hasKDF {
			delete(body, "kdf")
		}
		if err := validateEventBody(body, event); err != nil {
			status, message = http.StatusBadRequest, err.Error()
			return false, errors.New(message)
		}
		for _, field := range append([]string{"name", "kdf"}, extraFields...) {
			if value, ok := body[field]; ok {
				event[field] = value
			}
		}
		event["updatedAt"] = nowStamp()
		updated = ledger.Public(event)
		return true, nil
	})
	if err != nil {
		if status == -1 {
			return
		}
		if status == 0 {
			status, message = http.StatusInternalServerError, "保存失败"
		}
		fail(w, status, message)
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: updated})
}

// ---- DELETE /api/events/{id} ----

func (s *Server) handleDeleteEvent(w http.ResponseWriter, r *http.Request, id string) {
	var trashDir string
	var eventCopy map[string]any
	err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event, ok := events[id]
		if !ok {
			return false, inputError{http.StatusNotFound, "事件不存在"}
		}
		if !s.requireLedgerKey(w, r, event) {
			return false, rejectedError{}
		}
		dir, err := s.store.TrashEvent(id, event)
		if err != nil {
			return false, inputError{http.StatusInternalServerError, "删除失败：" + err.Error()}
		}
		trashDir = dir
		eventCopy = event
		delete(events, id)
		return true, nil
	})
	if err != nil {
		var input inputError
		if errors.As(err, &input) {
			fail(w, input.status, input.message)
			return
		}
		var rejected rejectedError
		if errors.As(err, &rejected) {
			return
		}
		if trashDir != "" {
			s.store.RestoreTrashedGifts(id, trashDir)
		}
		_ = eventCopy
		fail(w, http.StatusInternalServerError, "删除失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true})
}

// ---- POST /api/events/{id}/verify ----

func (s *Server) handleVerifyEvent(w http.ResponseWriter, r *http.Request, id string) {
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	event, ok := events[id]
	if !ok {
		fail(w, http.StatusNotFound, "事件不存在")
		return
	}
	if !s.requireLedgerKey(w, r, event) {
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true})
}

// ---- 账簿钥匙校验 ----

type inputError struct {
	status  int
	message string
}

func (e inputError) Error() string { return e.message }

type rejectedError struct{}

func (rejectedError) Error() string { return "rejected" }

// requireLedgerKey 校验 X-Ledger-Key；失败时已写出 403/429，返回 false。
// 错误次数与访问保护共用同一套 IP 防爆破记录（前缀 ledger: 区分用途）。
func (s *Server) requireLedgerKey(w http.ResponseWriter, r *http.Request, event map[string]any) bool {
	if !ledger.HasPassword(event) {
		return true
	}
	key := r.Header.Get("X-Ledger-Key")
	if !ledger.ValidKey(key) {
		key = ""
	}
	ip := "ledger:" + s.auth.ClientIP(r)
	if s.auth.ThrottleLocked(ip) {
		retry := s.auth.ThrottleRetryAfter(ip)
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
		failCode(w, http.StatusTooManyRequests, "ledger_locked",
			"管理密码错误次数过多，请 "+strconv.Itoa(int(retry.Minutes())+1)+" 分钟后再试")
		return false
	}
	if ledger.Matches(event, key) {
		s.auth.ThrottleClear(ip)
		return true
	}
	if key != "" {
		s.auth.ThrottleFail(ip)
	}
	if s.auth.ThrottleLocked(ip) {
		retry := s.auth.ThrottleRetryAfter(ip)
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
		failCode(w, http.StatusTooManyRequests, "ledger_locked",
			"管理密码错误次数过多，请 "+strconv.Itoa(int(retry.Minutes())+1)+" 分钟后再试")
		return false
	}
	if key == "" {
		failCode(w, http.StatusForbidden, "ledger_key", "请先输入管理密码解锁这本账簿")
		return false
	}
	time.Sleep(300 * time.Millisecond)
	fails := s.auth.ThrottleFails(ip)
	left := 5 - fails
	if left < 1 {
		left = 1
	}
	failCode(w, http.StatusForbidden, "ledger_key", "管理密码不正确，还可尝试 "+strconv.Itoa(left)+" 次")
	return false
}
