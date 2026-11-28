package api

import (
	"net/http"
	"testing"

	"giftbook/internal/store"
)

func TestFamilyPreferencesRoundTrip(t *testing.T) {
	env := newEnv(t)
	cookie := env.loginFamily(t, "", store.DefaultFamilyID)
	// 首次读取应为空：服务端没有权威副本，前端以本机为准并上传。
	res, payload := env.do(t, "GET", "/api/family/preferences", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取偏好失败: %d %v", res.StatusCode, payload)
	}
	if payload["data"] != nil {
		t.Fatalf("首次读取应返回空数据，实际 %v", payload["data"])
	}

	// 关闭自定义分类
	res, payload = env.do(t, "PUT", "/api/family/preferences", map[string]any{
		"preferences": map[string]any{
			"enabledCategories": []string{"red", "white"},
			"homeCategory":      "red",
			"largeText":         true,
			"motion":            "reduce",
			"sound":             true,
		},
	}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("保存偏好失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "GET", "/api/family/preferences", nil, map[string]string{"Cookie": cookie})
	data := payload["data"].(map[string]any)
	cats := data["enabledCategories"].([]any)
	if len(cats) != 2 || cats[0] != "red" || cats[1] != "white" {
		t.Fatalf("分类偏好未生效: %v", cats)
	}
	if data["largeText"] != true || data["motion"] != "reduce" || data["sound"] != true {
		t.Fatalf("偏好字段未保存: %v", data)
	}
}

func TestFamilyPreferencesSanitize(t *testing.T) {
	env := newEnv(t)
	cookie := env.loginFamily(t, "", store.DefaultFamilyID)
	// 非法分类与越界数值应被清洗为默认
	res, payload := env.do(t, "PUT", "/api/family/preferences", map[string]any{
		"preferences": map[string]any{
			"enabledCategories": []string{"hack", "red", "red"},
			"homeCategory":      "hack",
			"motion":            "invalid",
			"voiceRate":         99,
		},
	}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("保存失败: %d %v", res.StatusCode, payload)
	}
	data := payload["data"].(map[string]any)
	if len(data["enabledCategories"].([]any)) != 1 || data["homeCategory"] != "red" {
		t.Fatalf("非法分类未清洗: %v", data)
	}
	if data["motion"] != "system" || data["voiceRate"] != 1.0 {
		t.Fatalf("非法数值未清洗: %v", data)
	}
}
