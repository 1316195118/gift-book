package api

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"giftbook/internal/store"
)

// 来访签到：与宾客礼金登记共用公开链接机制，但字段独立（visitEnabled/visitToken），
// 只登记姓名、人数、备注。提交即计入，不经待确认。名单以明文跟随账簿 stored，
// 因此备份/还原/删除自动继承；不含金额，也不进入礼金统计。

var errVisitLedgerEnded = errors.New("visit ledger ended")

func (s *Server) findVisitEvent(token string) (string, store.Record, bool) {
	if len(token) < 16 || len(token) > 64 {
		return "", nil, false
	}
	events, err := s.store.ReadEvents()
	if err != nil {
		return "", nil, false
	}
	for id, event := range events {
		if enabled, _ := event["visitEnabled"].(bool); !enabled {
			continue
		}
		if expires, hasExpiry := guestExpiresAt(event); hasExpiry && !time.Now().Before(expires) {
			continue
		}
		saved, _ := event["visitToken"].(string)
		if saved != "" && subtle.ConstantTimeCompare([]byte(saved), []byte(token)) == 1 {
			return id, event, true
		}
	}
	return "", nil, false
}

// POST /api/events/{id}/visit（家庭成员：开启/关闭/重新生成来访登记）
func (s *Server) handleVisitToggle(w http.ResponseWriter, r *http.Request, id string) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled    *bool `json:"enabled"`
		Regenerate bool  `json:"regenerate"`
	}
	if err := decodeJSON(w, r, &body); err != nil || body.Enabled == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	var token string
	var expiresAt string
	err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event, exists := events[id]
		if !exists || !eventBelongsTo(event, family.ID) {
			return false, store.ErrNotFound
		}
		if *body.Enabled {
			if expires, hasExpiry := guestExpiresAt(event); hasExpiry && !time.Now().Before(expires) {
				return false, errVisitLedgerEnded
			}
			token, _ = event["visitToken"].(string)
			if token == "" || body.Regenerate {
				token = randomFamilyHex(16)
				event["visitToken"] = token
			}
			event["visitEnabled"] = true
			expiresAt = guestExpiresAtValue(event)
		} else {
			event["visitEnabled"] = false
			delete(event, "visitToken")
		}
		return true, nil
	})
	if err != nil {
		if errors.Is(err, errVisitLedgerEnded) {
			fail(w, http.StatusBadRequest, "账簿已结束，不能开启来访签到")
			return
		}
		fail(w, http.StatusNotFound, "账簿不存在")
		return
	}
	action := map[bool]string{true: "开启", false: "关闭"}[*body.Enabled]
	if body.Regenerate && *body.Enabled {
		action = "重新生成二维码"
	}
	s.audit(r, "来访签到", "", id+" "+action)
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"enabled":   *body.Enabled,
		"token":     token,
		"url":       "/?visit=" + token,
		"expiresAt": expiresAt,
	}})
}

// GET /api/visit/{token}（公开：来访登记页信息）
func (s *Server) handleVisitInfo(w http.ResponseWriter, r *http.Request) {
	if ok, retry := s.guestLimiter.allow(s.guestIPRateKey(r, "visit-info-ip"), guestInfoIPLimit, guestInfoIPWindow); !ok {
		writeGuestRateLimit(w, retry, "读取登记信息太频繁，请稍后再试")
		return
	}
	if ok, retry := s.guestLimiter.allow(s.guestRateKey(r, "visit-info"), guestInfoLimit, guestInfoWindow); !ok {
		writeGuestRateLimit(w, retry, "读取登记信息太频繁，请稍后再试")
		return
	}
	id, event, ok := s.findVisitEvent(r.PathValue("token"))
	if !ok {
		fail(w, http.StatusNotFound, "登记入口已关闭或链接不正确")
		return
	}
	name, _ := event["name"].(string)
	category, _ := event["category"].(string)
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"eventId": id, "name": name, "category": category, "expiresAt": guestExpiresAtValue(event),
	}})
}

// POST /api/visit/{token}（公开：提交一条来访登记，直接计入）
func (s *Server) handleVisitSubmit(w http.ResponseWriter, r *http.Request) {
	if ok, retry := s.guestLimiter.allow(s.guestIPRateKey(r, "visit-submit-ip"), guestIPLimit, guestIPWindow); !ok {
		writeGuestRateLimit(w, retry, "提交太频繁，请稍后再试")
		return
	}
	if ok, retry := s.guestLimiter.allow(s.guestRateKey(r, "visit-submit"), guestSubmitLimit, guestSubmitWindow); !ok {
		writeGuestRateLimit(w, retry, "提交太频繁，请稍后再试")
		return
	}
	id, _, ok := s.findVisitEvent(r.PathValue("token"))
	if !ok {
		fail(w, http.StatusNotFound, "登记入口已关闭或链接不正确")
		return
	}
	var body struct {
		Name    string `json:"name"`
		Count   int    `json:"count"`
		Note    string `json:"note"`
		Website string `json:"website"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	name := strings.TrimSpace(body.Name)
	note := strings.TrimSpace(body.Note)
	// 蜜罐字段：只有自动脚本会填，返回成功但不落库。
	if strings.TrimSpace(body.Website) != "" {
		writeJSON(w, http.StatusOK, response{Success: true, Message: "已登记"})
		return
	}
	if name == "" || utf8.RuneCountInString(name) > 20 ||
		utf8.RuneCountInString(note) > 100 {
		fail(w, http.StatusBadRequest, "姓名 1–20 字，备注请短一些")
		return
	}
	if body.Count < 1 || body.Count > 100 {
		fail(w, http.StatusBadRequest, "人数请在 1 – 100 之间")
		return
	}
	visit := store.Visit{
		ID: store.RandomVisitID(), Name: name, Count: body.Count,
		Note: note, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := s.store.AddVisit(id, visit); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Message: "已登记，谢谢"})
}

// listVisit 校验家庭内的账簿归属。
func (s *Server) listVisit(w http.ResponseWriter, r *http.Request, id string) bool {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return false
	}
	events, err := s.store.ReadEvents()
	if err != nil || events[id] == nil || !eventBelongsTo(events[id], family.ID) {
		fail(w, http.StatusNotFound, "账簿不存在")
		return false
	}
	return true
}

// GET /api/events/{id}/visit（家庭成员：查看来访名单）
func (s *Server) handleVisitList(w http.ResponseWriter, r *http.Request, id string) {
	if !s.listVisit(w, r, id) {
		return
	}
	items, err := s.store.Visits(id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "来访名单读取失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: items})
}

// DELETE /api/events/{id}/visit/{visitID}（家庭成员：删除一条来访记录）
func (s *Server) handleVisitDelete(w http.ResponseWriter, r *http.Request, id string) {
	if !s.listVisit(w, r, id) {
		return
	}
	if err := s.store.RemoveVisit(id, r.PathValue("visitID")); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit(r, "删除来访登记", "", id+" "+r.PathValue("visitID"))
	writeJSON(w, http.StatusOK, response{Success: true})
}
