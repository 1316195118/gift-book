package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

// getBytes 下载二进制响应（备份 zip），testEnv.do 只解析 JSON。
func (e *testEnv) getBytes(t *testing.T, path, cookie string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest("GET", e.server.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.RemoteAddr = "127.0.0.1:12345"
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	return res, raw
}

// postFile 以 multipart 上传备份包；extra 用于补 X-Family-Code 这类二次验证头。
func (e *testEnv) postFile(t *testing.T, path, cookie, name string, data []byte, extra ...map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest("POST", e.server.URL+path, &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	for _, headers := range extra {
		for key, value := range headers {
			req.Header.Set(key, value)
		}
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	var payload map[string]any
	_ = json.Unmarshal(raw, &payload)
	return res, payload
}

func readZipFiles(t *testing.T, raw []byte) map[string][]byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("不是有效的 zip: %v", err)
	}
	out := map[string][]byte{}
	for _, entry := range reader.File {
		rc, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		out[entry.Name] = content
	}
	return out
}

// 家庭备份只含当前家庭；不能还原到别的家庭，也不能当整站备份还原。
func TestFamilyBackupScope(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")

	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "张家", "accessCode": "zhangjia2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建张家失败: %d %v", res.StatusCode, payload)
	}
	zhangID := payload["data"].(map[string]any)["id"].(string)
	res, payload = env.do(t, "POST", "/api/families", map[string]any{
		"name": "李家", "accessCode": "lijia2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建李家失败: %d %v", res.StatusCode, payload)
	}
	liID := payload["data"].(map[string]any)["id"].(string)

	zhangCookie := env.loginFamily(t, "zhangjia2026", "")
	liCookie := env.loginFamily(t, "lijia2026", "")
	res, payload = env.do(t, "POST", "/api/events", map[string]any{
		"name": "张家婚宴", "passwordHash": noPassKey, "familyId": liID,
	}, map[string]string{"Cookie": zhangCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("张家建账失败: %d %v", res.StatusCode, payload)
	}
	zhangEvent := payload["data"].(map[string]any)["id"].(string)
	res, payload = env.do(t, "POST", "/api/events", map[string]any{
		"name": "李家满月酒", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": liCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("李家建账失败: %d %v", res.StatusCode, payload)
	}

	// 客户端伪造 familyId 不起作用：账簿仍落在当前家庭。
	events, err := env.store.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if got := events[zhangEvent]["familyId"]; got != zhangID {
		t.Fatalf("账簿应归入张家的 %s，实际 %v", zhangID, got)
	}

	// 家庭备份只含张家一本账簿。
	res, raw := env.getBytes(t, "/api/family/backup", zhangCookie)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("下载家庭备份失败: %d", res.StatusCode)
	}
	files := readZipFiles(t, raw)
	var manifest map[string]any
	if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest["scope"] != "family" || manifest["familyId"] != zhangID {
		t.Fatalf("家庭备份清单不正确: %v", manifest)
	}
	var backupEvents map[string]map[string]any
	if err := json.Unmarshal(files["data/events.json"], &backupEvents); err != nil {
		t.Fatal(err)
	}
	if len(backupEvents) != 1 || backupEvents[zhangEvent] == nil {
		t.Fatalf("家庭备份应只含张家账簿，实际 %v", backupEvents)
	}
	if _, leaked := files["config/auth-state.json"]; leaked {
		t.Fatal("家庭备份不应包含管理员密码状态")
	}
	res, payload = env.do(t, "GET", "/api/family/me", nil, map[string]string{"Cookie": zhangCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取家庭信息失败: %d", res.StatusCode)
	}
	if payload["data"].(map[string]any)["lastBackupAt"] == nil {
		t.Fatal("家庭备份后应记录 lastBackupAt")
	}

	// 家庭成员拿不到整站备份（其中含管理员密码状态），只能用家庭备份。
	res, payload = env.do(t, "GET", "/api/backup", nil, map[string]string{"Cookie": zhangCookie})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("家庭成员不应下载整站备份: %d %v", res.StatusCode, payload)
	}

	// 整站备份必须带家庭清单，否则换机还原会丢家庭与访问码。
	res, siteRaw := env.getBytes(t, "/api/backup", admin)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("下载整站备份失败: %d", res.StatusCode)
	}
	siteFiles := readZipFiles(t, siteRaw)
	var siteManifest map[string]any
	if err := json.Unmarshal(siteFiles["manifest.json"], &siteManifest); err != nil {
		t.Fatal(err)
	}
	if siteManifest["families"].(float64) != 3 {
		t.Fatalf("整站备份家庭数不对（默认 + 张家 + 李家）: %v", siteManifest)
	}
	var siteFamilies map[string]map[string]any
	if err := json.Unmarshal(siteFiles["data/families.json"], &siteFamilies); err != nil {
		t.Fatalf("整站备份缺少家庭清单: %v", err)
	}
	if siteFamilies[zhangID] == nil || siteFamilies[liID] == nil {
		t.Fatalf("整站备份家庭清单不完整: %v", siteFamilies)
	}

	// 张家备份不能还原到李家（跨家庭即使带了张家访问码也要拒绝）。
	res, payload = env.postFile(t, "/api/family/backup/restore", liCookie, "zhang.zip", raw, map[string]string{"X-Family-Code": "lijia2026"})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("跨家庭还原应被拒绝: %d %v", res.StatusCode, payload)
	}
	// 家庭备份不能当整站备份还原。
	res, payload = env.postFile(t, "/api/backup/restore", admin, "zhang.zip", raw)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("家庭备份用于整站还原应被拒绝: %d %v", res.StatusCode, payload)
	}
	// 还原到张家本身应成功（要重新输入一次家庭访问码）。
	res, payload = env.postFile(t, "/api/family/backup/restore", zhangCookie, "zhang.zip", raw, map[string]string{"X-Family-Code": "zhangjia2026"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("张家还原失败: %d %v", res.StatusCode, payload)
	}
	if payload["data"].(map[string]any)["events"].(float64) != 1 {
		t.Fatalf("还原账簿数不对: %v", payload)
	}
	// 李家仍只有自己那一本，且两家的账簿归属没有被还原串掉。
	liEvents, _, err := env.store.BackupFamily(liID)
	if err != nil {
		t.Fatal(err)
	}
	if len(liEvents) != 1 {
		t.Fatalf("李家账簿被家庭还原影响: %v", liEvents)
	}
	events, err = env.store.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	for id, event := range events {
		if event["familyId"] == nil {
			t.Fatalf("账簿 %s 还原后丢失家庭归属", id)
		}
	}
	if events[zhangEvent]["familyId"] != zhangID {
		t.Fatalf("张家账簿还原后归属错误: %v", events[zhangEvent]["familyId"])
	}
}

// 删除家庭：必须管理员密码二次验证 + 名称确认；账簿归档到 .trash。
func TestDeleteFamilyRequiresPassword(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "待删家庭", "accessCode": "shanchujia2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)
	cookie := env.loginFamily(t, "shanchujia2026", "")
	res, _ = env.do(t, "POST", "/api/events", map[string]any{
		"name": "待删账簿", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d", res.StatusCode)
	}

	// 密码错误
	res, _ = env.do(t, "DELETE", "/api/families/"+familyID, map[string]any{
		"currentPassword": "wrongpass", "confirmName": "待删家庭",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("密码错误应被拒绝: %d", res.StatusCode)
	}
	// 名称不匹配
	res, _ = env.do(t, "DELETE", "/api/families/"+familyID, map[string]any{
		"currentPassword": "adminpass123", "confirmName": "别的家庭",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("名称不匹配应被拒绝: %d", res.StatusCode)
	}
	// 默认家庭不能删
	res, _ = env.do(t, "DELETE", "/api/families/fam_default", map[string]any{
		"currentPassword": "adminpass123", "confirmName": "我的家庭",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("默认家庭应禁止删除: %d", res.StatusCode)
	}
	// 正确密码 + 正确名称
	res, payload = env.do(t, "DELETE", "/api/families/"+familyID, map[string]any{
		"currentPassword": "adminpass123", "confirmName": "待删家庭",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("删除家庭失败: %d %v", res.StatusCode, payload)
	}
	if payload["data"].(map[string]any)["events"].(float64) != 1 {
		t.Fatalf("归档账簿数不对: %v", payload)
	}
	families, err := env.store.ReadFamilies()
	if err != nil {
		t.Fatal(err)
	}
	if _, still := families[familyID]; still {
		t.Fatal("家庭删除后仍在列表里")
	}
	events, err := env.store.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatalf("删除家庭后账簿应移走，实际 %v", events)
	}
	// 家庭会话应失效
	res, _ = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("删除家庭后旧会话应失效: %d", res.StatusCode)
	}
}

// 改访问码后旧 Cookie 立即失效，新 Cookie 继续可用。
func TestFamilyCodeChangeInvalidatesSessions(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "换码家庭", "accessCode": "oldcode2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)
	oldCookie := env.loginFamily(t, "oldcode2026", "")

	// 家庭成员自助换码：当前码正确才允许。
	res, _ = env.do(t, "PUT", "/api/family/self", map[string]any{
		"currentCode": "wrongcode", "newCode": "newcode2026",
	}, map[string]string{"Cookie": oldCookie})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("当前码错误应被拒绝: %d", res.StatusCode)
	}
	res, payload = env.do(t, "PUT", "/api/family/self", map[string]any{
		"currentCode": "oldcode2026", "newCode": "newcode2026",
	}, map[string]string{"Cookie": oldCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("自助换码失败: %d %v", res.StatusCode, payload)
	}
	var newCookie string
	for _, c := range res.Cookies() {
		if c.Name == familyCookieName {
			newCookie = c.Name + "=" + c.Value
		}
	}
	if newCookie == "" {
		t.Fatal("换码后没有换发 Cookie")
	}
	res, _ = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": oldCookie})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("旧 Cookie 应失效: %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": newCookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("新 Cookie 应可用: %d", res.StatusCode)
	}

	// 管理员强制下线：当前 Cookie 再次失效。
	res, _ = env.do(t, "POST", "/api/families/"+familyID+"/logout-all", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("强制下线失败: %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": newCookie})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("强制下线后 Cookie 应失效: %d", res.StatusCode)
	}
}

// 删除家庭后能列出归档并恢复成新的开放家庭；账簿归属改到新家庭。
func TestFamilyArchiveRestore(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "归档家庭", "accessCode": "archive2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)
	cookie := env.loginFamily(t, "archive2026", "")
	res, payload = env.do(t, "POST", "/api/events", map[string]any{
		"name": "归档账簿", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d %v", res.StatusCode, payload)
	}
	eventID := payload["data"].(map[string]any)["id"].(string)
	res, _ = env.do(t, "DELETE", "/api/families/"+familyID, map[string]any{
		"currentPassword": "adminpass123", "confirmName": "归档家庭",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("删除家庭失败: %d", res.StatusCode)
	}

	res, payload = env.do(t, "GET", "/api/family/archives", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取归档失败: %d %v", res.StatusCode, payload)
	}
	var archiveName string
	for _, raw := range payload["data"].([]any) {
		item := raw.(map[string]any)
		if item["familyName"] == "归档家庭" {
			archiveName = item["name"].(string)
		}
	}
	if archiveName == "" {
		t.Fatalf("没有找到归档: %v", payload)
	}

	res, payload = env.do(t, "POST", "/api/family/archives/restore/"+archiveName, nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("恢复归档失败: %d %v", res.StatusCode, payload)
	}
	newFamilyID := payload["data"].(map[string]any)["familyId"].(string)
	events, err := env.store.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if events[eventID] == nil || events[eventID]["familyId"] != newFamilyID {
		t.Fatalf("归档账簿未恢复或归属不对: %v", events[eventID])
	}
	families, err := env.store.ReadFamilies()
	if err != nil {
		t.Fatal(err)
	}
	name, _ := families[newFamilyID]["name"].(string)
	if !strings.Contains(name, "已恢复") {
		t.Fatalf("恢复家庭名称不对: %q", name)
	}
}

// 管理员列表带账簿数与最近活动；高危操作写入审计日志。
func TestFamilyOverviewAndAudit(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "总览家庭", "accessCode": "overview2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)
	cookie := env.loginFamily(t, "overview2026", "")
	env.do(t, "POST", "/api/events", map[string]any{"name": "总览账簿", "passwordHash": noPassKey}, map[string]string{"Cookie": cookie})

	res, payload = env.do(t, "GET", "/api/families", nil, map[string]string{"Cookie": admin})
	var found bool
	for _, raw := range payload["data"].([]any) {
		item := raw.(map[string]any)
		if item["id"] == familyID {
			found = true
			if item["eventCount"].(float64) != 1 {
				t.Fatalf("账簿数不对: %v", item)
			}
			if item["lastActiveAt"] == nil || item["lastActiveAt"] == "" {
				t.Fatalf("缺少最近活动时间: %v", item)
			}
		}
	}
	if !found {
		t.Fatal("家庭列表缺少目标家庭")
	}

	res, payload = env.do(t, "GET", "/api/audit", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取审计失败: %d %v", res.StatusCode, payload)
	}
	actions := map[string]bool{}
	for _, raw := range payload["data"].([]any) {
		actions[raw.(map[string]any)["action"].(string)] = true
	}
	if !actions["创建家庭"] || !actions["管理员密码更新"] {
		t.Fatalf("审计日志缺少动作: %v", actions)
	}
}

// 家庭级自动备份：定时/立即备份会为每个家庭单独生成 zip，可列出、下载、还原。
func TestFamilyAutoBackup(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "自动家庭", "accessCode": "autobak2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	cookie := env.loginFamily(t, "autobak2026", "")
	res, payload = env.do(t, "POST", "/api/events", map[string]any{
		"name": "自动账簿", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d %v", res.StatusCode, payload)
	}

	res, payload = env.do(t, "PUT", "/api/autobackup", map[string]any{
		"enabled": true, "intervalHours": 24, "keep": 3,
		"familyEnabled": true, "familyKeep": 2,
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("保存自动备份设置失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "POST", "/api/autobackup/run", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("立即备份失败: %d %v", res.StatusCode, payload)
	}

	res, payload = env.do(t, "GET", "/api/family/auto-backups", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取家庭自动备份失败: %d %v", res.StatusCode, payload)
	}
	files := payload["data"].(map[string]any)["files"].([]any)
	if len(files) == 0 {
		t.Fatal("家庭自动备份没有生成文件")
	}
	name := files[0].(map[string]any)["name"].(string)

	res, raw := env.getBytes(t, "/api/family/auto-backups/"+name, cookie)
	if res.StatusCode != http.StatusOK || len(raw) < 100 {
		t.Fatalf("下载家庭自动备份失败: %d", res.StatusCode)
	}
	res, payload = env.do(t, "POST", "/api/family/auto-backups/restore/"+name, nil, map[string]string{
		"Cookie": cookie, "X-Family-Code": "autobak2026",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("还原家庭自动备份失败: %d %v", res.StatusCode, payload)
	}

	res, payload = env.do(t, "GET", "/api/family/me", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK || payload["data"].(map[string]any)["lastAutoBackupAt"] == nil {
		t.Fatalf("家庭自动备份后应记录 lastAutoBackupAt: %v", payload)
	}
}
