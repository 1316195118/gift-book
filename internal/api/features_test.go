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

// 多家庭隔离：每个家庭只看到自己的账簿，跨家庭读写与回收站恢复都要被拒绝。
func TestFamilyIsolation(t *testing.T) {
	env := newEnv(t)
	adminCookie := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "张家", "accessCode": "zhangjia2026",
	}, map[string]string{"Cookie": adminCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建张家失败: %d %v", res.StatusCode, payload)
	}
	res, _ = env.do(t, "POST", "/api/families", map[string]any{
		"name": "李家", "accessCode": "lijia2026",
	}, map[string]string{"Cookie": adminCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建李家失败: %d", res.StatusCode)
	}
	zhangCookie := env.loginFamily(t, "zhangjia2026", "")
	liCookie := env.loginFamily(t, "lijia2026", "")

	res, payload = env.do(t, "POST", "/api/events", map[string]any{
		"name": "张家婚宴", "passwordHash": noPassKey, "template": "婚宴",
	}, map[string]string{"Cookie": zhangCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("张家建账失败: %d %v", res.StatusCode, payload)
	}
	zhangEvent := payload["data"].(map[string]any)["id"].(string)

	// 李家列表里不应出现张家账簿。
	res, payload = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": liCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("李家读列表失败: %d", res.StatusCode)
	}
	if _, ok := payload["data"].(map[string]any)[zhangEvent]; ok {
		t.Fatal("李家看到了张家账簿")
	}
	// 直接按 ID 读 / 读礼金也必须是 404。
	for _, path := range []string{"/api/events/" + zhangEvent, "/api/gifts?eventId=" + zhangEvent} {
		res, _ = env.do(t, "GET", path, nil, map[string]string{"Cookie": liCookie})
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("跨家庭访问 %s 应返回 404，实际 %d", path, res.StatusCode)
		}
	}
	// 多家庭模式下必须先选家庭；默认家庭也看不到张家账簿。
	defaultCookie := env.loginFamily(t, "", "fam_default")
	res, payload = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": defaultCookie})
	if _, ok := payload["data"].(map[string]any)[zhangEvent]; ok {
		t.Fatal("默认家庭看到了张家账簿")
	}

	// 张家删除后，回收站只对张家可见；李家不能恢复。
	res, _ = env.do(t, "DELETE", "/api/events/"+zhangEvent, nil, map[string]string{"Cookie": zhangCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("张家删除账簿失败: %d", res.StatusCode)
	}
	res, payload = env.do(t, "GET", "/api/trash", nil, map[string]string{"Cookie": zhangCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("张家读回收站失败: %d", res.StatusCode)
	}
	var snapshot string
	for _, raw := range payload["data"].([]any) {
		item, _ := raw.(map[string]any)
		if item["eventId"] == zhangEvent {
			snapshot, _ = item["name"].(string)
		}
	}
	if snapshot == "" {
		t.Fatal("张家回收站里没有刚删除的账簿")
	}
	res, payload = env.do(t, "GET", "/api/trash", nil, map[string]string{"Cookie": liCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("李家读回收站失败: %d", res.StatusCode)
	}
	for _, raw := range payload["data"].([]any) {
		item, _ := raw.(map[string]any)
		if item["eventId"] == zhangEvent {
			t.Fatal("李家看到了张家的回收站快照")
		}
	}
	res, _ = env.do(t, "POST", "/api/trash/restore/"+snapshot, nil, map[string]string{"Cookie": liCookie})
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("李家恢复张家快照应返回 404，实际 %d", res.StatusCode)
	}

	// 错误访问码被拒绝，合法访问码写入了家庭 Cookie。
	res, payload = env.do(t, "POST", "/api/family/login", map[string]any{"accessCode": "wrong-code"}, nil)
	if res.StatusCode != http.StatusForbidden || payload["code"] != "family_code" {
		t.Fatalf("错误访问码应被拒绝: %d %v", res.StatusCode, payload)
	}
}

// 家庭登录：默认家庭没有访问码时可直接进入；主动退出后不再自动回退。
func TestFamilyGateAndDefaultFallback(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "GET", "/api/family/me", nil, nil)
	if res.StatusCode != http.StatusOK || payload["data"].(map[string]any)["id"] != "fam_default" {
		t.Fatalf("默认家庭应可直接进入: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "POST", "/api/family/logout", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("退出家庭失败: %d", res.StatusCode)
	}
	var cookie string
	for _, c := range res.Cookies() {
		if c.Name == familyCookieName {
			cookie = c.Value
		}
	}
	res, payload = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": familyCookieName + "=" + cookie})
	if res.StatusCode != http.StatusUnauthorized || payload["code"] != "family_required" {
		t.Fatalf("退出家庭后应要求重新选择: %d %v", res.StatusCode, payload)
	}
}

func (e *testEnv) loginFamily(t *testing.T, code, familyID string) string {
	t.Helper()
	body := map[string]any{"accessCode": code}
	if familyID != "" {
		body = map[string]any{"familyId": familyID}
	}
	res, payload := e.do(t, "POST", "/api/family/login", body, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("家庭登录失败: %d %v", res.StatusCode, payload)
	}
	for _, c := range res.Cookies() {
		if c.Name == familyCookieName {
			return familyCookieName + "=" + c.Value
		}
	}
	t.Fatal("家庭登录没有下发 Cookie")
	return ""
}

// 开放家庭：访问码留空也能创建，家庭门列出后可免码进入；补上访问码后从列表消失。
func TestOpenFamilyLifecycle(t *testing.T) {
	env := newEnv(t)
	adminCookie := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{"name": "王家"}, map[string]string{"Cookie": adminCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建开放家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)
	res, payload = env.do(t, "GET", "/api/families/open", nil, nil)
	found := false
	for _, raw := range payload["data"].([]any) {
		item, _ := raw.(map[string]any)
		if item["id"] == familyID {
			found = true
		}
	}
	if !found {
		t.Fatal("开放家庭没有出现在家庭门列表里")
	}
	cookie := env.loginFamily(t, "", familyID)
	res, payload = env.do(t, "GET", "/api/family/me", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK || payload["data"].(map[string]any)["name"] != "王家" {
		t.Fatalf("免码进入开放家庭失败: %d %v", res.StatusCode, payload)
	}

	// 改为需要访问码，开放列表不再包含它。
	res, payload = env.do(t, "PUT", "/api/families/"+familyID, map[string]any{"accessCode": "wangjia2026"}, map[string]string{"Cookie": adminCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("设置访问码失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "GET", "/api/families/open", nil, nil)
	for _, raw := range payload["data"].([]any) {
		item, _ := raw.(map[string]any)
		if item["id"] == familyID {
			t.Fatal("设置访问码后仍出现在开放家庭列表")
		}
	}
	res, _ = env.do(t, "POST", "/api/family/login", map[string]any{"familyId": familyID}, nil)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("有码家庭免码进入应被拒绝，实际 %d", res.StatusCode)
	}
	env.loginFamily(t, "wangjia2026", "")
}

// 站点管理员用管理员密码登录后，可以越过家庭访问码进入任意家庭。
func TestSiteAdminCanEnterAnyFamily(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "PUT", "/api/auth", map[string]any{
		"enabled": true, "password": "adminpass123",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("开启访问保护失败: %d %v", res.StatusCode, payload)
	}
	var authCookie string
	for _, c := range res.Cookies() {
		authCookie = c.Name + "=" + c.Value
	}
	if authCookie == "" {
		t.Fatal("开启访问保护后没有下发登录 Cookie")
	}
	res, payload = env.do(t, "POST", "/api/families", map[string]any{
		"name": "管理员测试家庭", "accessCode": "family2026",
	}, map[string]string{"Cookie": authCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)

	// 管理员不输家庭码，直接按 familyId 进入。
	res, payload = env.do(t, "POST", "/api/family/login", map[string]any{"familyId": familyID}, map[string]string{"Cookie": authCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("管理员应可越过家庭码进入: %d %v", res.StatusCode, payload)
	}
	var familyCookie string
	for _, c := range res.Cookies() {
		if c.Name == familyCookieName {
			familyCookie = c.Name + "=" + c.Value
		}
	}
	res, payload = env.do(t, "GET", "/api/family/me", nil, map[string]string{"Cookie": authCookie + "; " + familyCookie})
	if res.StatusCode != http.StatusOK || payload["data"].(map[string]any)["name"] != "管理员测试家庭" {
		t.Fatalf("管理员进入家庭失败: %d %v", res.StatusCode, payload)
	}
}

// 设置管理员密码后，普通家庭成员仍应能用家庭访问码进入，只是看不到管理员接口。
func TestAdminPasswordDoesNotBlockFamilyAccess(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "PUT", "/api/auth", map[string]any{
		"enabled": true, "password": "adminpass123",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("设置管理员密码失败: %d %v", res.StatusCode, payload)
	}
	var authCookie string
	for _, c := range res.Cookies() {
		authCookie = c.Name + "=" + c.Value
	}
	res, payload = env.do(t, "POST", "/api/families", map[string]any{
		"name": "张家", "accessCode": "zhangjia2026",
	}, map[string]string{"Cookie": authCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}

	familyCookie := env.loginFamily(t, "zhangjia2026", "")
	res, payload = env.do(t, "GET", "/api/family/me", nil, map[string]string{"Cookie": familyCookie})
	if res.StatusCode != http.StatusOK || payload["data"].(map[string]any)["name"] != "张家" {
		t.Fatalf("家庭成员无法进入: %d %v", res.StatusCode, payload)
	}
	if admin, _ := payload["data"].(map[string]any)["admin"].(bool); admin {
		t.Fatal("普通家庭成员不应被标记为管理员")
	}
	res, _ = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": familyCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("家庭成员读取账簿失败: %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/families", nil, map[string]string{"Cookie": familyCookie})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("家庭成员不应访问家庭管理接口，实际 %d", res.StatusCode)
	}
}

// 多家庭强制管理员密码：没有密码不能建第二个家庭，建了之后也不能关闭密码。
func TestMultiFamilyRequiresAdminPassword(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "POST", "/api/families", map[string]any{"name": "张家"}, nil)
	if res.StatusCode != http.StatusForbidden || payload["code"] != "admin_password_required" {
		t.Fatalf("未设管理员密码时建第二个家庭应被拒绝: %d %v", res.StatusCode, payload)
	}

	adminCookie := env.enableAdminPassword(t, "adminpass123")
	res, payload = env.do(t, "POST", "/api/families", map[string]any{"name": "张家"}, map[string]string{"Cookie": adminCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("设置管理员密码后建家庭失败: %d %v", res.StatusCode, payload)
	}

	res, payload = env.do(t, "GET", "/api/auth", nil, nil)
	if multi, _ := payload["multiFamily"].(bool); !multi {
		t.Fatal("多家庭标记应为 true")
	}

	res, payload = env.do(t, "PUT", "/api/auth", map[string]any{
		"enabled": false, "currentPassword": "adminpass123",
	}, map[string]string{"Cookie": adminCookie})
	if res.StatusCode != http.StatusForbidden || payload["code"] != "admin_password_required" {
		t.Fatalf("多家庭下关闭管理员密码应被拒绝: %d %v", res.StatusCode, payload)
	}
}

func (e *testEnv) enableAdminPassword(t *testing.T, password string) string {
	t.Helper()
	res, payload := e.do(t, "PUT", "/api/auth", map[string]any{"enabled": true, "password": password}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("设置管理员密码失败: %d %v", res.StatusCode, payload)
	}
	for _, c := range res.Cookies() {
		return c.Name + "=" + c.Value
	}
	t.Fatal("设置管理员密码后没有下发 Cookie")
	return ""
}
