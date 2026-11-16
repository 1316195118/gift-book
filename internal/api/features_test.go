package api

import (
	"net/http"
	"strings"
	"testing"
)

// 结簿归档后，礼金的增 / 改 / 删都要被服务端拒绝，读与解除结簿仍可用。
func TestArchivedEventBlocksGiftWrites(t *testing.T) {
	env := newEnv(t)
	id := env.createEvent(t, "结簿测试", noPassKey)

	res, payload := env.do(t, "POST", "/api/gifts", map[string]any{
		"eventId": id, "encryptedContent": validCipher(11), "requestId": "req-archive-1",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("写入初始礼金失败: %d %v", res.StatusCode, payload)
	}
	giftID := payload["data"].(map[string]any)["id"].(string)

	res, payload = env.do(t, "PUT", "/api/events/"+id, map[string]any{
		"archived": true, "archivedAt": "2026-11-15T20:00:00Z",
	}, nil)
	if res.StatusCode != http.StatusOK || payload["data"].(map[string]any)["archived"] != true {
		t.Fatalf("结簿失败: %d %v", res.StatusCode, payload)
	}

	writes := []struct {
		method, path string
		body         any
	}{
		{"POST", "/api/gifts", map[string]any{
			"eventId": id, "encryptedContent": validCipher(12), "requestId": "req-archive-2",
		}},
		{"PUT", "/api/gifts/" + giftID + "?eventId=" + id, map[string]any{
			"eventId": id, "encryptedContent": validCipher(13),
		}},
		{"DELETE", "/api/gifts/" + giftID + "?eventId=" + id, nil},
	}
	for _, write := range writes {
		res, payload = env.do(t, write.method, write.path, write.body, nil)
		if res.StatusCode != http.StatusForbidden || payload["code"] != "archived" {
			t.Errorf("%s %s 应被结簿拦截，实际 %d %v", write.method, write.path, res.StatusCode, payload)
		}
	}

	res, _ = env.do(t, "GET", "/api/gifts?eventId="+id, nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Errorf("结簿后仍应能读取礼金，实际 %d", res.StatusCode)
	}

	res, _ = env.do(t, "PUT", "/api/events/"+id, map[string]any{
		"archived": false, "archivedAt": "",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("解除结簿失败: %d", res.StatusCode)
	}
	res, payload = env.do(t, "POST", "/api/gifts", map[string]any{
		"eventId": id, "encryptedContent": validCipher(14), "requestId": "req-archive-3",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("解除结簿后应能录入，实际 %d %v", res.StatusCode, payload)
	}
}

// 删除账簿后能在回收站里看到，并连同礼金一起恢复；重复恢复不会覆盖。
func TestTrashListAndRestore(t *testing.T) {
	env := newEnv(t)
	id := env.createEvent(t, "回收站测试", noPassKey)
	res, payload := env.do(t, "POST", "/api/gifts", map[string]any{
		"eventId": id, "encryptedContent": validCipher(21), "requestId": "req-trash-1",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("写入礼金失败: %d %v", res.StatusCode, payload)
	}
	res, _ = env.do(t, "DELETE", "/api/events/"+id, nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("删除账簿失败: %d", res.StatusCode)
	}

	res, payload = env.do(t, "GET", "/api/trash", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取回收站失败: %d %v", res.StatusCode, payload)
	}
	items, _ := payload["data"].([]any)
	var name string
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if ok && item["kind"] == "event" && item["eventId"] == id {
			name, _ = item["name"].(string)
			if count, ok := item["giftCount"].(float64); !ok || count != 1 {
				t.Errorf("快照里的礼金条数应为 1，实际 %v", item["giftCount"])
			}
		}
	}
	if name == "" {
		t.Fatalf("回收站没列出被删账簿: %v", payload["data"])
	}

	res, payload = env.do(t, "POST", "/api/trash/restore/"+name, nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("恢复失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "GET", "/api/events", nil, nil)
	if _, ok := payload["data"].(map[string]any)[id]; !ok {
		t.Fatalf("恢复后账簿不在列表里: %v", payload["data"])
	}
	res, payload = env.do(t, "GET", "/api/gifts?eventId="+id, nil, nil)
	if len(payload["data"].(map[string]any)) != 1 {
		t.Fatalf("恢复后礼金数不对: %v", payload["data"])
	}

	res, _ = env.do(t, "POST", "/api/trash/restore/"+name, nil, nil)
	if res.StatusCode == http.StatusOK {
		t.Fatal("重复恢复应被拒绝，避免覆盖已存在的账簿")
	}
}

// 有密码账簿删除后，从回收站恢复也必须校验管理密码，与删除时一致。
func TestRestoreTrashRequiresLedgerKey(t *testing.T) {
	env := newEnv(t)
	key := strings.Repeat("a", 64)
	id := env.createEvent(t, "有密码账簿", key)
	res, payload := env.do(t, "DELETE", "/api/events/"+id, nil, map[string]string{"X-Ledger-Key": key})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("删除失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "GET", "/api/trash", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取回收站失败: %d %v", res.StatusCode, payload)
	}
	var name string
	for _, raw := range payload["data"].([]any) {
		item, _ := raw.(map[string]any)
		if item["kind"] == "event" && item["eventId"] == id {
			name, _ = item["name"].(string)
		}
	}
	if name == "" {
		t.Fatalf("快照未列出: %v", payload["data"])
	}
	res, payload = env.do(t, "POST", "/api/trash/restore/"+name, nil, nil)
	if res.StatusCode != http.StatusForbidden || payload["code"] != "ledger_key" {
		t.Fatalf("无密码恢复应被拒绝: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "POST", "/api/trash/restore/"+name, nil, map[string]string{"X-Ledger-Key": key})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("带正确密码恢复失败: %d %v", res.StatusCode, payload)
	}
}

// 非法的结簿字段不能被写入，避免污染 events.json。
func TestArchivedFieldValidation(t *testing.T) {
	env := newEnv(t)
	id := env.createEvent(t, "字段校验", noPassKey)
	res, _ := env.do(t, "PUT", "/api/events/"+id, map[string]any{"archived": "yes"}, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("非布尔结簿状态应被拒绝，实际 %d", res.StatusCode)
	}
	res, _ = env.do(t, "PUT", "/api/events/"+id, map[string]any{"archivedAt": 123}, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("非字符串结簿时间应被拒绝，实际 %d", res.StatusCode)
	}
}
