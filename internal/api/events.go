package api

import (
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
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
	"totalAmount", "coverStyle", "archived", "archivedAt", "perPage", "ceremonyAt", "pageRules",
}

// normalizePageRules 规整「第 X–Y 页用 N 行」的区间规则：
// 只保留合法、互不重叠的规则，按起始页排序，最多 20 条。
func normalizePageRules(value any) []map[string]int {
	raw, ok := value.([]any)
	if !ok {
		return []map[string]int{}
	}
	out := make([]map[string]int, 0, len(raw))
	for _, item := range raw {
		fields, ok := item.(map[string]any)
		if !ok {
			continue
		}
		from := int(numberValue(fields["from"]))
		to := int(numberValue(fields["to"]))
		size := int(numberValue(fields["perPage"]))
		if from < 1 || from > 9999 || (to != 0 && to < from) {
			continue
		}
		if size != 8 && size != 10 && size != 12 {
			continue
		}
		out = append(out, map[string]int{"from": from, "to": to, "perPage": size})
	}
	sort.Slice(out, func(i, j int) bool { return out[i]["from"] < out[j]["from"] })
	kept := make([]map[string]int, 0, len(out))
	lastTo := 0
	for _, rule := range out {
		if rule["from"] <= lastTo {
			continue
		}
		kept = append(kept, rule)
		if rule["to"] > 0 {
			lastTo = rule["to"]
		}
		if len(kept) >= 20 {
			break
		}
	}
	return kept
}

func numberValue(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case string:
		n, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return n
	}
	return 0
}

// normalizePerPage 只接受 8 / 10 / 12，旧账簿没有这个字段时按 12 处理。
func normalizePerPage(value any) int {
	n, _ := value.(float64)
	if n != 8 && n != 10 && n != 12 {
		return 12
	}
	return int(n)
}

// ---- GET /api/events ----

// familyEvents 只挑出当前家庭的账簿，避免跨家庭泄露。
func familyEvents(events map[string]store.Record, familyID string) map[string]store.Record {
	mine := make(map[string]store.Record, len(events))
	for id, event := range events {
		if eventBelongsTo(event, familyID) {
			mine[id] = event
		}
	}
	return mine
}

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	mine := familyEvents(events, family.ID)
	// 补齐历史账簿缺失的编号（只补缺失的，按创建时间排序）。
	// 补号要写回 events.json，必须在写锁内基于最新数据重算：
	// 用读锁外拿到的快照写回，会覆盖同一时间别人改的名称或总额。
	if needsDisplayIDBackfill(mine) {
		if err := s.store.WithEvents(func(current map[string]store.Record) (bool, error) {
			mine = familyEvents(current, family.ID)
			return s.backfillDisplayIDs(mine), nil
		}); err != nil {
			fail(w, http.StatusInternalServerError, "账簿升级保存失败")
			return
		}
	}
	out := make(map[string]map[string]any, len(mine))
	for id, event := range mine {
		public := ledger.Public(event)
		public["giftCount"] = s.store.CountGifts(id)
		out[id] = public
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: out})
}

// needsDisplayIDBackfill 只读判断是否有账簿缺编号，避免每次列表都去抢写锁。
func needsDisplayIDBackfill(events map[string]store.Record) bool {
	for _, event := range events {
		display, _ := event["displayId"].(string)
		if len(display) != 3 || !isDigits(display) {
			return true
		}
	}
	return false
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
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	event, exists := events[id]
	if !exists || !eventBelongsTo(event, family.ID) {
		fail(w, http.StatusNotFound, "事件不存在")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: ledger.Public(event)})
}

// ---- POST /api/events ----

func (s *Server) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	var body map[string]any
	if err := decodeJSON(w, r, &body); err != nil || body == nil {
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
			if !eventBelongsTo(existing, family.ID) {
				continue
			}
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
			"familyId":  family.ID,
			"createdAt": stamp,
			"updatedAt": stamp,
		}
		for k, v := range ledger.VerifierFields(newKey) {
			event[k] = v
		}
		for _, field := range append([]string{"kdf"}, extraFields...) {
			if value, ok := body[field]; ok {
				if field == "perPage" {
					event[field] = normalizePerPage(value)
					continue
				}
				if field == "pageRules" {
					event[field] = normalizePageRules(value)
					continue
				}
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
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	var body map[string]any
	if err := decodeJSON(w, r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	var updated map[string]any
	var status int
	var message string
	err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event, exists := events[id]
		if !exists || !eventBelongsTo(event, family.ID) {
			status, message = http.StatusNotFound, "事件不存在"
			return false, errors.New(message)
		}
		if !s.requireLedgerKey(w, r, event) {
			status = -1 // 已写出响应
			return false, errors.New("ledger key rejected")
		}
		delete(body, "passwordHash")
		delete(body, "familyId")
		if _, hasKDF := event["kdf"]; hasKDF {
			delete(body, "kdf")
		}
		if err := validateEventBody(body, event); err != nil {
			status, message = http.StatusBadRequest, err.Error()
			return false, errors.New(message)
		}
		for _, field := range append([]string{"name", "kdf"}, extraFields...) {
			if value, ok := body[field]; ok {
				if field == "perPage" {
					event[field] = normalizePerPage(value)
					continue
				}
				if field == "pageRules" {
					event[field] = normalizePageRules(value)
					continue
				}
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
	s.notifyChange(r, "event", "updated", id, "")
	writeJSON(w, http.StatusOK, response{Success: true, Data: updated})
}

// ---- POST /api/events/{id}/move（站点管理员：把账簿转到其他家庭） ----

// 账簿建立后无法通过普通修改改归属（客户端传的 familyId 一律忽略），
// 建错家庭时只能在删除与重建之间选；这个接口让管理员把它移到正确的家庭。
func (s *Server) handleMoveEvent(w http.ResponseWriter, r *http.Request, id string) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以转移账簿")
		return
	}
	var body struct {
		FamilyID string `json:"familyId"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	target := strings.TrimSpace(body.FamilyID)
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭数据读取失败")
		return
	}
	targetRec, exists := families[target]
	if !exists {
		fail(w, http.StatusBadRequest, "目标家庭不存在")
		return
	}
	targetFamily := familyFromRecord(target, targetRec)
	if targetFamily.Archived {
		fail(w, http.StatusBadRequest, "目标家庭已归档")
		return
	}

	var eventName, fromName string
	err = s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event, ok := events[id]
		if !ok {
			return false, store.ErrNotFound
		}
		current := familyIDOf(event)
		if current == "" {
			current = store.DefaultFamilyID
		}
		if current == target {
			return false, errors.New("账簿已经在这个家庭里")
		}
		if rec, ok := families[current]; ok {
			fromName, _ = rec["name"].(string)
		}
		eventName, _ = event["name"].(string)
		event["familyId"] = target
		event["updatedAt"] = nowStamp()
		return true, nil
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			fail(w, http.StatusNotFound, "账簿不存在")
			return
		}
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	from := fromName
	if from == "" {
		from = "我的家庭"
	}
	s.audit(r, "转移账簿", targetFamily.Name, eventName+" ← "+from)
	// 两个家庭里的页面都要刷新：原家庭少一本，目标家庭多一本。
	s.notifyAllChange(r, "event", "moved")
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]string{
		"id": id, "name": eventName, "familyId": target, "familyName": targetFamily.Name,
	}})
}

// ---- DELETE /api/events/{id} ----

func (s *Server) handleDeleteEvent(w http.ResponseWriter, r *http.Request, id string) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	var trashDir string
	err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event, exists := events[id]
		if !exists || !eventBelongsTo(event, family.ID) {
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
		fail(w, http.StatusInternalServerError, "删除失败")
		return
	}
	s.notifyChange(r, "event", "deleted", id, "")
	writeJSON(w, http.StatusOK, response{Success: true})
}

// ---- POST /api/events/{id}/verify ----

func (s *Server) handleVerifyEvent(w http.ResponseWriter, r *http.Request, id string) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	events, err := s.store.ReadEvents()
	if err != nil {
		fail(w, http.StatusInternalServerError, "账簿读取失败")
		return
	}
	event, exists := events[id]
	if !exists || !eventBelongsTo(event, family.ID) {
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
