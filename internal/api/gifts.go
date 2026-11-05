package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"giftbook/internal/ledger"
	"giftbook/internal/store"
)

const maxCipherSize = 8 << 20

// 礼金接口全部通过 store.Tx 在一次读-改-写里完成：
// 父账簿存在性检查、账簿钥匙校验与礼金落盘共享同一把锁，
// 不会出现「账簿刚被删除还写入礼金」，也不会在同一把锁内重复加锁。

func (s *Server) handleGetGifts(w http.ResponseWriter, r *http.Request) {
	eventID := r.URL.Query().Get("eventId")
	if !eventIDPattern.MatchString(eventID) {
		fail(w, http.StatusBadRequest, "缺少事件ID")
		return
	}
	var out map[string]map[string]any
	var status int
	var message string
	err := s.store.Tx(eventID, true, func(events map[string]store.Record, gifts map[string]store.Record) (bool, bool, error) {
		event, ok := events[eventID]
		if !ok {
			status, message = http.StatusNotFound, "事件不存在"
			return false, false, errors.New(message)
		}
		migrated, valid := ledger.Migrate(event)
		if !s.requireLedgerKey(w, r, event) {
			status = -1
			return migrated && valid, false, errors.New("rejected")
		}
		out = make(map[string]map[string]any, len(gifts))
		for id, gift := range gifts {
			out[id] = publicGift(gift)
		}
		return migrated && valid, false, nil
	})
	if err != nil {
		if status == -1 {
			return
		}
		if status == 0 {
			status, message = http.StatusInternalServerError, "账簿读取失败"
		}
		fail(w, status, message)
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: out})
}

func (s *Server) handleCreateGift(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	eventID, _ := body["eventId"].(string)
	if !eventIDPattern.MatchString(eventID) {
		fail(w, http.StatusBadRequest, "缺少事件ID")
		return
	}
	requestID := ""
	if raw, ok := body["requestId"]; ok {
		candidate, isString := raw.(string)
		if !isString || len(candidate) < 8 || len(candidate) > 64 {
			fail(w, http.StatusBadRequest, "无效的请求ID")
			return
		}
		requestID = candidate
	}
	cipher, ok := body["encryptedContent"].(string)
	if !ok {
		fail(w, http.StatusBadRequest, "缺少必要参数")
		return
	}
	if err := validateCipher(cipher); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}

	var created map[string]any
	var duplicate map[string]any
	var status int
	var message string
	err := s.store.Tx(eventID, true, func(events map[string]store.Record, gifts map[string]store.Record) (bool, bool, error) {
		event, exists := events[eventID]
		if !exists {
			status, message = http.StatusNotFound, "事件不存在"
			return false, false, errors.New(message)
		}
		migrated, valid := ledger.Migrate(event)
		if !s.requireLedgerKey(w, r, event) {
			status = -1
			return migrated && valid, false, errors.New("rejected")
		}
		if requestID != "" {
			for _, existing := range gifts {
				if value, _ := existing["requestId"].(string); value == requestID {
					duplicate = publicGift(existing)
					return migrated && valid, false, nil
				}
			}
		}
		stamp := nowStamp()
		gift := map[string]any{
			"id":               store.NewID(),
			"eventId":          eventID,
			"encryptedContent": cipher,
			"createdAt":        stamp,
			"updatedAt":        stamp,
		}
		if requestID != "" {
			gift["requestId"] = requestID
		}
		gifts[gift["id"].(string)] = gift
		created = publicGift(gift)
		return migrated && valid, true, nil
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
	if duplicate != nil {
		writeJSON(w, http.StatusOK, response{Success: true, Data: duplicate, Duplicate: true})
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: created})
}

func (s *Server) handleUpdateGift(w http.ResponseWriter, r *http.Request, giftID string) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil || body == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	eventID, _ := body["eventId"].(string)
	if !eventIDPattern.MatchString(eventID) {
		fail(w, http.StatusBadRequest, "缺少事件ID")
		return
	}
	cipher, hasCipher := body["encryptedContent"].(string)
	if !hasCipher {
		fail(w, http.StatusBadRequest, "缺少加密内容")
		return
	}
	if err := validateCipher(cipher); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	ifMatch, _ := body["ifMatch"].(string)

	var updated map[string]any
	var status int
	var message, code string
	err := s.store.Tx(eventID, true, func(events map[string]store.Record, gifts map[string]store.Record) (bool, bool, error) {
		event, exists := events[eventID]
		if !exists {
			status, message = http.StatusNotFound, "事件不存在"
			return false, false, errors.New(message)
		}
		migrated, valid := ledger.Migrate(event)
		if !s.requireLedgerKey(w, r, event) {
			status = -1
			return migrated && valid, false, errors.New("rejected")
		}
		gift, ok := gifts[giftID]
		if !ok {
			status, message = http.StatusNotFound, "礼物不存在"
			return migrated && valid, false, errors.New(message)
		}
		if ifMatch != "" {
			current, _ := gift["encryptedContent"].(string)
			sum := sha256.Sum256([]byte(current))
			if ifMatch != hex.EncodeToString(sum[:]) {
				status, code = http.StatusConflict, "conflict"
				message = "这笔记录已在其他设备上修改，请刷新后再改"
				return migrated && valid, false, errors.New(message)
			}
		}
		gift["encryptedContent"] = cipher
		// 旧版遗留的明文字段在修改时一并清掉。
		for _, field := range []string{"name", "amount", "giverName"} {
			delete(gift, field)
		}
		gift["updatedAt"] = nowStamp()
		updated = publicGift(gift)
		return migrated && valid, true, nil
	})
	if err != nil {
		if status == -1 {
			return
		}
		if status == 0 {
			status, message = http.StatusInternalServerError, "保存失败"
		}
		if code != "" {
			failCode(w, status, code, message)
			return
		}
		fail(w, status, message)
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: updated})
}

func (s *Server) handleDeleteGift(w http.ResponseWriter, r *http.Request, giftID string) {
	eventID := r.URL.Query().Get("eventId")
	if !eventIDPattern.MatchString(eventID) {
		fail(w, http.StatusBadRequest, "缺少事件ID")
		return
	}
	var status int
	var message string
	err := s.store.Tx(eventID, true, func(events map[string]store.Record, gifts map[string]store.Record) (bool, bool, error) {
		event, exists := events[eventID]
		if !exists {
			status, message = http.StatusNotFound, "事件不存在"
			return false, false, errors.New(message)
		}
		migrated, valid := ledger.Migrate(event)
		if !s.requireLedgerKey(w, r, event) {
			status = -1
			return migrated && valid, false, errors.New("rejected")
		}
		if _, ok := gifts[giftID]; !ok {
			status, message = http.StatusNotFound, "礼物不存在"
			return migrated && valid, false, errors.New(message)
		}
		delete(gifts, giftID)
		return migrated && valid, true, nil
	})
	if err != nil {
		if status == -1 {
			return
		}
		if status == 0 {
			status, message = http.StatusInternalServerError, "删除失败"
		}
		fail(w, status, message)
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true})
}

// publicGift 只返回协议内字段，旧版遗留的姓名/金额等明文一律不下发。
func publicGift(gift map[string]any) map[string]any {
	out := make(map[string]any, 5)
	for _, field := range []string{"id", "eventId", "encryptedContent", "createdAt", "updatedAt"} {
		if value, ok := gift[field]; ok {
			out[field] = value
		}
	}
	return out
}

// validateCipher 检查密文长度与格式（v2 或旧版 OpenSSL 兼容格式）。
func validateCipher(cipher string) error {
	if len(cipher) > maxCipherSize {
		return errors.New("加密内容不能超过8MB")
	}
	if !cipherUsable(cipher) {
		return errors.New("无效的加密内容")
	}
	return nil
}

func cipherUsable(value string) bool {
	if value == "" {
		return false
	}
	raw, err := decodeBase64(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	if len(raw) >= 4 && string(raw[:4]) == "GBv2" {
		return len(raw) >= 4+16+16+32 && (len(raw)-52)%16 == 0
	}
	return len(raw) >= 32 && string(raw[:8]) == "Salted__" && (len(raw)-16)%16 == 0
}
