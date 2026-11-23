package api

import (
	"crypto/subtle"
	"math"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"giftbook/internal/store"
)

// 宾客扫码登记：主家为一个账簿打开公开登记入口，宾客填的内容先以明文进入待确认区，
// 主家在账簿里确认时才用账簿密钥加密入库，并立即删除明文。
// 这是有意的设计取舍：服务端没有账簿密钥，无法替主家加密。

func (s *Server) findGuestEvent(token string) (string, store.Record, bool) {
	if len(token) < 16 || len(token) > 64 {
		return "", nil, false
	}
	events, err := s.store.ReadEvents()
	if err != nil {
		return "", nil, false
	}
	for id, event := range events {
		if enabled, _ := event["guestEnabled"].(bool); !enabled {
			continue
		}
		saved, _ := event["guestToken"].(string)
		if saved != "" && subtle.ConstantTimeCompare([]byte(saved), []byte(token)) == 1 {
			return id, event, true
		}
	}
	return "", nil, false
}

// POST /api/events/{id}/guest（家庭成员：开启/关闭宾客登记）
func (s *Server) handleGuestToggle(w http.ResponseWriter, r *http.Request, id string) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if err := decodeJSON(w, r, &body); err != nil || body.Enabled == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	var token string
	err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		event, exists := events[id]
		if !exists || !eventBelongsTo(event, family.ID) {
			return false, store.ErrNotFound
		}
		if *body.Enabled {
			token, _ = event["guestToken"].(string)
			if token == "" {
				token = randomFamilyHex(16)
				event["guestToken"] = token
			}
			event["guestEnabled"] = true
		} else {
			event["guestEnabled"] = false
		}
		return true, nil
	})
	if err != nil {
		fail(w, http.StatusNotFound, "账簿不存在")
		return
	}
	if !*body.Enabled {
		if err := s.store.ClearGuestInbox(id); err != nil {
			fail(w, http.StatusInternalServerError, "关闭失败，请重试")
			return
		}
		token = ""
	}
	s.audit(r, "宾客扫码登记", "", id+" "+(map[bool]string{true: "开启", false: "关闭"})[*body.Enabled])
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"enabled": *body.Enabled,
		"token":   token,
		"url":     "/?gift=" + token,
	}})
}

// GET /api/guest/{token}（公开：登记页信息，不含任何礼金）
func (s *Server) handleGuestInfo(w http.ResponseWriter, r *http.Request) {
	if ok, retry := s.guestLimiter.allow(s.guestIPRateKey(r, "info-ip"), guestInfoIPLimit, guestInfoIPWindow); !ok {
		writeGuestRateLimit(w, retry, "读取登记信息太频繁，请稍后再试")
		return
	}
	if ok, retry := s.guestLimiter.allow(s.guestRateKey(r, "info"), guestInfoLimit, guestInfoWindow); !ok {
		writeGuestRateLimit(w, retry, "读取登记信息太频繁，请稍后再试")
		return
	}
	id, event, ok := s.findGuestEvent(r.PathValue("token"))
	if !ok {
		fail(w, http.StatusNotFound, "登记入口已关闭或链接不正确")
		return
	}
	name, _ := event["name"].(string)
	category, _ := event["category"].(string)
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"eventId": id, "name": name, "category": category,
	}})
}

// POST /api/guest/{token}/gifts（公开：提交一条待确认登记）
func (s *Server) handleGuestSubmit(w http.ResponseWriter, r *http.Request) {
	if ok, retry := s.guestLimiter.allow(s.guestIPRateKey(r, "submit-ip"), guestIPLimit, guestIPWindow); !ok {
		writeGuestRateLimit(w, retry, "提交太频繁，请稍后再试")
		return
	}
	if ok, retry := s.guestLimiter.allow(s.guestRateKey(r, "submit"), guestSubmitLimit, guestSubmitWindow); !ok {
		writeGuestRateLimit(w, retry, "提交太频繁，请稍后再试")
		return
	}
	id, _, ok := s.findGuestEvent(r.PathValue("token"))
	if !ok {
		fail(w, http.StatusNotFound, "登记入口已关闭或链接不正确")
		return
	}
	var body struct {
		Name     string  `json:"name"`
		Amount   float64 `json:"amount"`
		Relation string  `json:"relation"`
		Note     string  `json:"note"`
		Website  string  `json:"website"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	name := strings.TrimSpace(body.Name)
	relation := strings.TrimSpace(body.Relation)
	note := strings.TrimSpace(body.Note)
	// 隐藏字段只有自动脚本会填写。返回成功但不落库，避免给爬虫明确的试验信号。
	if strings.TrimSpace(body.Website) != "" {
		writeJSON(w, http.StatusOK, response{Success: true, Message: "已登记，等主家确认后入簿"})
		return
	}
	if name == "" || utf8.RuneCountInString(name) > 20 ||
		utf8.RuneCountInString(relation) > 20 || utf8.RuneCountInString(note) > 100 {
		fail(w, http.StatusBadRequest, "姓名 1–20 字，关系与备注请短一些")
		return
	}
	if math.IsNaN(body.Amount) || math.IsInf(body.Amount, 0) ||
		body.Amount < 0.01 || body.Amount > 1000000 {
		fail(w, http.StatusBadRequest, "金额请在 0.01 – 1000000 之间")
		return
	}
	entry := store.GuestEntry{
		ID: store.RandomGuestID(), Name: name, Amount: body.Amount,
		Relation: relation, Note: note, IP: s.auth.ClientIP(r),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := s.store.AddGuestEntry(id, entry); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Message: "已登记，等主家确认后入簿"})
}

// listGuestPending 校验家庭内的账簿归属。
func (s *Server) listGuestPending(w http.ResponseWriter, r *http.Request, id string) bool {
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

func (s *Server) handleGuestPending(w http.ResponseWriter, r *http.Request, id string) {
	if !s.listGuestPending(w, r, id) {
		return
	}
	items, err := s.store.GuestInbox(id)
	if err != nil {
		fail(w, http.StatusInternalServerError, "待确认登记读取失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: items})
}

func (s *Server) handleGuestDismiss(w http.ResponseWriter, r *http.Request, id string) {
	if !s.listGuestPending(w, r, id) {
		return
	}
	if err := s.store.RemoveGuestEntry(id, r.PathValue("entry")); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit(r, "忽略宾客登记", "", id)
	writeJSON(w, http.StatusOK, response{Success: true})
}
