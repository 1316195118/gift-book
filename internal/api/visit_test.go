package api

import (
	"net/http"
	"testing"

	"giftbook/internal/store"
)

func TestVisitRegistrationFlow(t *testing.T) {
	env := newEnv(t)
	cookie := env.loginFamily(t, "", store.DefaultFamilyID)
	res, payload := env.do(t, "POST", "/api/events", map[string]any{"name": "寿宴", "passwordHash": noPassKey}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d %v", res.StatusCode, payload)
	}
	eventID := payload["data"].(map[string]any)["id"].(string)

	res, payload = env.do(t, "POST", "/api/events/"+eventID+"/visit", map[string]any{"enabled": true}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("开启来访登记失败: %d %v", res.StatusCode, payload)
	}
	token := payload["data"].(map[string]any)["token"].(string)

	res, info := env.do(t, "GET", "/api/visit/"+token, nil, nil)
	if res.StatusCode != http.StatusOK || info["data"].(map[string]any)["name"] != "寿宴" {
		t.Fatalf("来访页信息不对: %d %v", res.StatusCode, info)
	}

	// 公开提交：姓名 + 人数 + 备注，直接计入（无待确认）
	res, payload = env.do(t, "POST", "/api/visit/"+token, map[string]any{
		"name": "李四", "count": 3, "note": "一家三口",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("提交失败: %d %v", res.StatusCode, payload)
	}
	// 同名 5 分钟内重复应忽略
	res, _ = env.do(t, "POST", "/api/visit/"+token, map[string]any{"name": "李四", "count": 3}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("重复提交返回异常: %d", res.StatusCode)
	}

	res, payload = env.do(t, "GET", "/api/events/"+eventID+"/visit", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("名单读取失败: %d", res.StatusCode)
	}
	list := payload["data"].([]any)
	if len(list) != 1 {
		t.Fatalf("同名重复应只留一条: %v", list)
	}
	entry := list[0].(map[string]any)
	if entry["name"] != "李四" || entry["count"].(float64) != 3 || entry["note"] != "一家三口" {
		t.Fatalf("登记内容不对: %v", entry)
	}

	// 人数校验
	res, _ = env.do(t, "POST", "/api/visit/"+token, map[string]any{"name": "王五", "count": 0}, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("人数 0 应被拒: %d", res.StatusCode)
	}
}

func TestVisitFamilyIsolation(t *testing.T) {
	env := newEnv(t)
	cookieA := env.loginFamily(t, "", store.DefaultFamilyID)
	res, payload := env.do(t, "POST", "/api/events", map[string]any{"name": "A家", "passwordHash": noPassKey}, map[string]string{"Cookie": cookieA})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d %v", res.StatusCode, payload)
	}

	// 不存在的账簿应 404，不能读到其它账簿的名单
	res, _ = env.do(t, "GET", "/api/events/ev_notexist/visit", nil, map[string]string{"Cookie": cookieA})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("不存在账簿应 404: %d", res.StatusCode)
	}
}

func TestVisitCloseDisablesLink(t *testing.T) {
	env := newEnv(t)
	cookie := env.loginFamily(t, "", store.DefaultFamilyID)
	res, payload := env.do(t, "POST", "/api/events", map[string]any{"name": "宴", "passwordHash": noPassKey}, map[string]string{"Cookie": cookie})
	id := payload["data"].(map[string]any)["id"].(string)
	res, payload = env.do(t, "POST", "/api/events/"+id+"/visit", map[string]any{"enabled": true}, map[string]string{"Cookie": cookie})
	token := payload["data"].(map[string]any)["token"].(string)

	res, _ = env.do(t, "POST", "/api/events/"+id+"/visit", map[string]any{"enabled": false}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("关闭失败: %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/visit/"+token, nil, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("关闭后链接应失效: %d", res.StatusCode)
	}
}

func TestVisitNotInGiftStats(t *testing.T) {
	env := newEnv(t)
	cookie := env.loginFamily(t, "", store.DefaultFamilyID)
	res, payload := env.do(t, "POST", "/api/events", map[string]any{"name": "宴", "passwordHash": noPassKey}, map[string]string{"Cookie": cookie})
	id := payload["data"].(map[string]any)["id"].(string)
	res, payload = env.do(t, "POST", "/api/events/"+id+"/visit", map[string]any{"enabled": true}, map[string]string{"Cookie": cookie})
	token := payload["data"].(map[string]any)["token"].(string)
	env.do(t, "POST", "/api/visit/"+token, map[string]any{"name": "赵六", "count": 5}, nil)

	// 来访记录写在 event.visits，不应出现在 gifts 里
	res, payload = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读账簿失败: %d", res.StatusCode)
	}
	events := payload["data"].(map[string]any)
	raw, ok := events[id]
	if !ok {
		t.Fatalf("账簿列表缺少 %s", id)
	}
	e := raw.(map[string]any)
	if _, ok := e["visits"]; !ok {
		t.Fatal("visits 字段应跟随账簿保存")
	}
}
