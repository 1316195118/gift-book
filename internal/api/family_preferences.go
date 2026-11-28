package api

import (
	"net/http"

	"giftbook/internal/store"
)

// 家庭级界面偏好：同一家庭的所有设备共享。
// 存于 families.json 的家庭记录 preferences 字段；前端保留 localStorage 作离线缓存。
// 设备级数据（离线缓存、待补传队列、操作员标识、提示已读）不属于偏好，不在此同步。

var preferenceCategories = map[string]bool{"red": true, "white": true, "custom": true}

// sanitizeFamilyPreferences 用白名单逐字段校验，非法值回落到默认，
// 避免客户端把任意结构写进 families.json。
func sanitizeFamilyPreferences(raw any) store.Record {
	src := store.Record{}
	switch v := raw.(type) {
	case store.Record:
		src = v
	case map[string]any:
		src = store.Record(v)
	}
	out := store.Record{}

	// 分类显示：非空白名单子集
	cats := normalizePreferenceCategories(src["enabledCategories"])
	if len(cats) == 0 {
		cats = defaultPreferenceCategories()
	}
	out["enabledCategories"] = cats

	// 当前分类必须是启用项之一
	home, _ := src["homeCategory"].(string)
	if !preferenceCategories[home] || !containsString(cats, home) {
		home = cats[0]
	}
	out["homeCategory"] = home

	// 大字：布尔
	large, _ := src["largeText"].(bool)
	out["largeText"] = large

	// 动效：system / full / reduce
	motion, _ := src["motion"].(string)
	if motion != "full" && motion != "reduce" {
		motion = "system"
	}
	out["motion"] = motion

	// 音效：布尔
	sound, _ := src["sound"].(bool)
	out["sound"] = sound

	// 语速与音量：数值区间
	out["voiceRate"] = clampPreferenceNumber(src["voiceRate"], 0.5, 2, 1)
	out["voiceVolume"] = clampPreferenceNumber(src["voiceVolume"], 0, 1, 1)

	// 打印选项：枚举
	print := store.Record{}
	if p, ok := src["print"].(store.Record); ok {
		print = p
	} else if p, ok := src["print"].(map[string]any); ok {
		print = store.Record(p)
	}
	fontSize, _ := print["fontSize"].(string)
	if fontSize != "large" && fontSize != "xlarge" {
		fontSize = "normal"
	}
	margin, _ := print["margin"].(string)
	if margin != "narrow" && margin != "wide" {
		margin = "normal"
	}
	appendix, hasAppendix := print["appendix"].(bool)
	if !hasAppendix {
		appendix = true
	}
	out["print"] = store.Record{"fontSize": fontSize, "margin": margin, "appendix": appendix}
	return out
}

func defaultPreferenceCategories() []string {
	return []string{"red", "white", "custom"}
}

func normalizePreferenceCategories(input any) []string {
	var list []string
	switch v := input.(type) {
	case []string:
		list = v
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok {
				list = append(list, s)
			}
		}
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(list))
	for _, key := range list {
		if !preferenceCategories[key] || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, key)
	}
	return out
}

func containsString(list []string, target string) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

func clampPreferenceNumber(raw any, min, max, fallback float64) float64 {
	n, ok := raw.(float64)
	if !ok || n < min || n > max {
		return fallback
	}
	return n
}

// readFamilyPreferences 返回家庭偏好；尚未保存过偏好时返回 nil，
// 表示「服务端没有权威副本」，前端应保留本机设置并主动上传，
// 否则首次登录会用默认值覆盖用户刚做的选择（如切到白事）。
func readFamilyPreferences(families map[string]store.Record, familyID string) store.Record {
	rec, exists := families[familyID]
	if !exists || rec["preferences"] == nil {
		return nil
	}
	return sanitizeFamilyPreferences(rec["preferences"])
}

// GET /api/family/preferences
func (s *Server) handleFamilyPreferences(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	families, err := s.store.ReadFamilies()
	if err != nil {
		fail(w, http.StatusInternalServerError, "读取偏好失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: readFamilyPreferences(families, family.ID)})
}

// PUT /api/family/preferences
func (s *Server) handleFamilyPreferencesSave(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	var body struct {
		Preferences store.Record `json:"preferences"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	clean := sanitizeFamilyPreferences(body.Preferences)
	err := s.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		rec, exists := families[family.ID]
		if !exists {
			return false, store.ErrNotFound
		}
		rec["preferences"] = clean
		families[family.ID] = rec
		return true, nil
	})
	if err != nil {
		fail(w, http.StatusInternalServerError, "保存偏好失败")
		return
	}
	s.audit(r, "修改家庭偏好", "", family.ID)
	writeJSON(w, http.StatusOK, response{Success: true, Data: clean})
}
