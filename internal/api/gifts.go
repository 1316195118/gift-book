package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"giftbook/internal/ledger"
	"giftbook/internal/store"
)

const maxCipherSize = 8 << 20

// 结簿归档后账簿只读：前端入口会隐藏，这里再兜一层，防止绕过界面直接写接口。
const archivedMessage = "账簿已结簿，处于只读状态；如需录入或修改，请先在「账簿设置」里解除结簿。"

// withinMinutes 判断 at（“YYYY-MM-DD HH:mm:ss”或 ISO 格式）与参考时间是否在 n 分钟内。
func withinMinutes(at, clientAt, stamp string, minutes int) bool {
	parse := func(value string) (int64, bool) {
		if value == "" {
			return 0, false
		}
		// 客户端提交的是带时区的 ISO（2026-11-18T12:00:00.000Z）；旧记录是服务端本地时间。
		// 两种格式都支持，统一换算成同一时刻再比较，避免跨时区差 8 小时。
		if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
			return parsed.Unix(), true
		}
		normalized := strings.Replace(value, "T", " ", 1)
		layout := "2006-01-02 15:04:05"
		if len(normalized) > 19 {
			normalized = normalized[:19]
		}
		parsed, err := time.ParseInLocation(layout, normalized, time.Local)
		if err != nil {
			return 0, false
		}
		return parsed.Unix(), true
	}
	left, ok1 := parse(at)
	right, ok2 := parse(clientAt)
	if !ok2 {
		right, ok2 = parse(stamp)
	}
	if !ok1 || !ok2 {
		return false
	}
	diff := left - right
	if diff < 0 {
		diff = -diff
	}
	return diff <= int64(minutes*60)
}

func isArchived(event map[string]any) bool {
	value, _ := event["archived"].(bool)
	return value
}

// 礼金读取先在共享读锁内复制快照，解锁后再执行钥匙校验和数据转换。
// 礼金写入通过 store.Tx 在一次读-改-写里完成；密码校验的节流和等待在事务外，
// 事务内只用无等待摘要复核权限，避免一次输错密码阻塞其他家庭成员。

func (s *Server) handleGetGifts(w http.ResponseWriter, r *http.Request) {
	family, familyOK := s.requireFamily(w, r)
	if !familyOK {
		return
	}
	eventID := r.URL.Query().Get("eventId")
	if !eventIDPattern.MatchString(eventID) {
		fail(w, http.StatusBadRequest, "缺少事件ID")
		return
	}
	var out map[string]map[string]any
	var status int
	var message string
	var needsMigration bool
	err := s.store.ViewTx(eventID, func(events map[string]store.Record, gifts map[string]store.Record) error {
		event, ok := events[eventID]
		if !ok || !eventBelongsTo(event, family.ID) {
			status, message = http.StatusNotFound, "事件不存在"
			return errors.New(message)
		}
		if !s.requireLedgerKey(w, r, event) {
			status = -1
			return errors.New("rejected")
		}
		migrated, valid := ledger.Migrate(event)
		needsMigration = migrated && valid
		out = make(map[string]map[string]any, len(gifts))
		for id, gift := range gifts {
			out[id] = publicGift(gift)
		}
		return nil
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
	// 只读请求不占用写锁；仅旧格式账簿第一次被读取时补一次迁移落盘。
	if needsMigration {
		_ = s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
			event, ok := events[eventID]
			if !ok || !eventBelongsTo(event, family.ID) {
				return false, nil
			}
			changed, valid := ledger.Migrate(event)
			return changed && valid, nil
		})
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: out})
}

func (s *Server) handleCreateGift(w http.ResponseWriter, r *http.Request) {
	family, familyOK := s.requireFamily(w, r)
	if !familyOK {
		return
	}
	var body map[string]any
	if err := decodeJSON(w, r, &body); err != nil || body == nil {
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
	clientAt := ""
	if raw, ok := body["clientAt"].(string); ok {
		clientAt = strings.TrimSpace(raw)
		if len(clientAt) > 32 {
			clientAt = ""
		}
	}
	nameHash := ""
	if raw, ok := body["nameHash"].(string); ok {
		hash := strings.ToLower(strings.TrimSpace(raw))
		if len(hash) == 64 {
			nameHash = hash
		}
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
	if _, ok := s.preflightLedgerAccess(w, r, eventID, family.ID); !ok {
		return
	}

	var created map[string]any
	var duplicate map[string]any
	var warning string
	var status int
	var message, code string
	err := s.store.Tx(eventID, true, func(events map[string]store.Record, gifts map[string]store.Record) (bool, bool, error) {
		event, exists := events[eventID]
		if !exists || !eventBelongsTo(event, family.ID) {
			status, message = http.StatusNotFound, "事件不存在"
			return false, false, errors.New(message)
		}
		if !ledgerRequestStillMatches(r, event) {
			status, message = http.StatusConflict, "账簿权限已变更，请刷新后重试"
			return false, false, errors.New(message)
		}
		if isArchived(event) {
			status, code, message = http.StatusForbidden, "archived", archivedMessage
			return false, false, errors.New(message)
		}
		migrated, valid := ledger.Migrate(event)
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
		if clientAt != "" {
			gift["clientAt"] = clientAt
		}
		if nameHash != "" {
			gift["nameHash"] = nameHash
		}
		if nameHash != "" {
			// 同名近邻提醒：不阻止写入，只告诉前端「10 分钟内已有一笔同名记录」。
			// 姓名哈希在服务端不可逆，仅用于比较，不泄露姓名本身。
			for _, existing := range gifts {
				if value, _ := existing["nameHash"].(string); value != nameHash {
					continue
				}
				at := ""
				if value, ok := existing["clientAt"].(string); ok && value != "" {
					at = value
				} else if value, ok := existing["createdAt"].(string); ok {
					at = value
				}
				if at != "" && withinMinutes(at, clientAt, stamp, 10) {
					warning = at
				}
				break
			}
		}
		gifts[gift["id"].(string)] = gift
		created = publicGift(gift)
		return migrated && valid, true, nil
	})
	if err != nil {
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
	if duplicate != nil {
		writeJSON(w, http.StatusOK, response{Success: true, Data: duplicate, Duplicate: true})
		return
	}
	if id, ok := created["id"].(string); ok {
		s.notifyChange(r, "gift", "created", eventID, id)
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: created, Warning: warning})
}

func (s *Server) handleUpdateGift(w http.ResponseWriter, r *http.Request, giftID string) {
	family, familyOK := s.requireFamily(w, r)
	if !familyOK {
		return
	}
	var body map[string]any
	if err := decodeJSON(w, r, &body); err != nil || body == nil {
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
	if _, ok := s.preflightLedgerAccess(w, r, eventID, family.ID); !ok {
		return
	}
	rawIfMatch, hasIfMatch := body["ifMatch"]
	if !hasIfMatch || rawIfMatch == nil {
		failCode(w, http.StatusPreconditionRequired, "precondition_required", "修改礼金必须提供版本标记，请刷新后重试")
		return
	}
	ifMatch, isString := rawIfMatch.(string)
	ifMatch = strings.TrimSpace(ifMatch)
	if !isString || len(ifMatch) != sha256.Size*2 {
		fail(w, http.StatusBadRequest, "无效的版本标记")
		return
	}
	if _, err := hex.DecodeString(ifMatch); err != nil {
		fail(w, http.StatusBadRequest, "无效的版本标记")
		return
	}

	var updated map[string]any
	var status int
	var message, code string
	err := s.store.Tx(eventID, true, func(events map[string]store.Record, gifts map[string]store.Record) (bool, bool, error) {
		event, exists := events[eventID]
		if !exists || !eventBelongsTo(event, family.ID) {
			status, message = http.StatusNotFound, "事件不存在"
			return false, false, errors.New(message)
		}
		if !ledgerRequestStillMatches(r, event) {
			status, message = http.StatusConflict, "账簿权限已变更，请刷新后重试"
			return false, false, errors.New(message)
		}
		if isArchived(event) {
			status, code, message = http.StatusForbidden, "archived", archivedMessage
			return false, false, errors.New(message)
		}
		migrated, valid := ledger.Migrate(event)
		gift, ok := gifts[giftID]
		if !ok {
			status, message = http.StatusNotFound, "礼物不存在"
			return migrated && valid, false, errors.New(message)
		}
		current, _ := gift["encryptedContent"].(string)
		sum := sha256.Sum256([]byte(current))
		if !strings.EqualFold(ifMatch, hex.EncodeToString(sum[:])) {
			status, code = http.StatusConflict, "conflict"
			message = "这笔记录已在其他设备上修改，请刷新后再改"
			return migrated && valid, false, errors.New(message)
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
	// 用请求体里已校验的 eventID：编辑礼金时前端把 eventId 放在请求体，
	// 只读查询串会拿到空值，其它设备就收不到这条更新。
	s.notifyChange(r, "gift", "updated", eventID, giftID)
	writeJSON(w, http.StatusOK, response{Success: true, Data: updated})
}

func (s *Server) handleDeleteGift(w http.ResponseWriter, r *http.Request, giftID string) {
	family, familyOK := s.requireFamily(w, r)
	if !familyOK {
		return
	}
	eventID := r.URL.Query().Get("eventId")
	if !eventIDPattern.MatchString(eventID) {
		fail(w, http.StatusBadRequest, "缺少事件ID")
		return
	}
	if _, ok := s.preflightLedgerAccess(w, r, eventID, family.ID); !ok {
		return
	}
	var status int
	var message, code string
	err := s.store.Tx(eventID, true, func(events map[string]store.Record, gifts map[string]store.Record) (bool, bool, error) {
		event, exists := events[eventID]
		if !exists || !eventBelongsTo(event, family.ID) {
			status, message = http.StatusNotFound, "事件不存在"
			return false, false, errors.New(message)
		}
		if !ledgerRequestStillMatches(r, event) {
			status, message = http.StatusConflict, "账簿权限已变更，请刷新后重试"
			return false, false, errors.New(message)
		}
		if isArchived(event) {
			status, code, message = http.StatusForbidden, "archived", archivedMessage
			return false, false, errors.New(message)
		}
		migrated, valid := ledger.Migrate(event)
		if _, ok := gifts[giftID]; !ok {
			status, message = http.StatusNotFound, "礼物不存在"
			return migrated && valid, false, errors.New(message)
		}
		delete(gifts, giftID)
		return migrated && valid, true, nil
	})
	if err != nil {
		if status == 0 {
			status, message = http.StatusInternalServerError, "删除失败"
		}
		if code != "" {
			failCode(w, status, code, message)
			return
		}
		fail(w, status, message)
		return
	}
	s.notifyChange(r, "gift", "deleted", r.URL.Query().Get("eventId"), giftID)
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
