package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"giftbook/internal/store"
)

// 备份包里的账簿必须属于包里存在的家庭，否则还原后这些账簿对任何家庭都不可见。
func TestBackupNormalizeRejectsOrphanFamily(t *testing.T) {
	parsed := &parsedBackup{
		events: map[string]store.Record{
			"evt_orphan": {"id": "evt_orphan", "name": "没有归属的账簿", "passwordHash": noPassKey, "familyId": "fam_missing"},
		},
		families: map[string]store.Record{
			store.DefaultFamilyID: {"id": store.DefaultFamilyID, "name": "我的家庭"},
		},
	}
	err := parsed.normalize()
	if err == nil || !strings.Contains(err.Error(), "不存在的家庭") {
		t.Fatalf("应拒绝归属未知家庭的账簿，实际: %v", err)
	}

	// 归属正常时不受影响。
	parsed.events["evt_orphan"]["familyId"] = store.DefaultFamilyID
	if err := parsed.normalize(); err != nil {
		t.Fatalf("正常归属不应被拒绝: %v", err)
	}
}

// 从自动备份还原是整站操作：必须留下审计记录，否则「谁把数据退回去了」无从追查。
func TestGlobalAutoBackupRestoreIsAudited(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/events", map[string]any{
		"name": "整站账簿", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "POST", "/api/autobackup/run", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("立即备份失败: %d %v", res.StatusCode, payload)
	}
	entries, err := os.ReadDir(filepath.Join(env.dir, "backups"))
	if err != nil || len(entries) == 0 {
		t.Fatalf("没有生成自动备份: %v", err)
	}
	name := entries[0].Name()
	res, payload = env.do(t, "POST", "/api/autobackup/restore/"+name, nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("从自动备份还原失败: %d %v", res.StatusCode, payload)
	}

	res, payload = env.do(t, "GET", "/api/audit", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取操作记录失败: %d %v", res.StatusCode, payload)
	}
	found := false
	for _, raw := range payload["data"].([]any) {
		entry := raw.(map[string]any)
		if entry["action"] != "整站还原" {
			continue
		}
		if detail, _ := entry["detail"].(string); !strings.Contains(detail, "自动备份") {
			t.Fatalf("整站还原记录缺少来源: %v", entry)
		}
		found = true
	}
	if !found {
		t.Fatalf("整站还原没有写审计记录: %v", payload["data"])
	}
}

// 家庭备份属于整站定时任务：整站开关关闭时要如实告诉成员「不会有备份」。
func TestFamilyAutoBackupFollowsSiteSwitch(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "备份家庭", "accessCode": "beifen2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	cookie := env.loginFamily(t, "beifen2026", "")

	res, payload = env.do(t, "PUT", "/api/autobackup", map[string]any{
		"enabled": false, "intervalHours": 24, "keep": 3,
		"familyEnabled": true, "familyKeep": 5,
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("保存设置失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "GET", "/api/family/auto-backups", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取家庭自动备份失败: %d %v", res.StatusCode, payload)
	}
	data := payload["data"].(map[string]any)
	if data["enabled"] != false || data["siteEnabled"] != false || data["familyEnabled"] != true {
		t.Fatalf("整站开关关闭时不应报告家庭备份可用: %v", data)
	}

	res, payload = env.do(t, "PUT", "/api/autobackup", map[string]any{
		"enabled": true, "intervalHours": 24, "keep": 3,
		"familyEnabled": true, "familyKeep": 5,
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("再次保存设置失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "GET", "/api/family/auto-backups", nil, map[string]string{"Cookie": cookie})
	if payload["data"].(map[string]any)["enabled"] != true {
		t.Fatalf("整站开关打开后应报告家庭备份可用: %v", payload["data"])
	}
}

// 整站还原必须把家庭清单和账簿一起换回来：只成功一半会让账簿归属到不存在的家庭。
func TestGlobalRestoreBringsBackFamily(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "张家", "accessCode": "zhangjia2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)
	cookie := env.loginFamily(t, "zhangjia2026", "")
	res, payload = env.do(t, "POST", "/api/events", map[string]any{
		"name": "张家婚宴", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d %v", res.StatusCode, payload)
	}
	eventID := payload["data"].(map[string]any)["id"].(string)

	res, raw := env.getBytes(t, "/api/backup", admin)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("下载整站备份失败: %d", res.StatusCode)
	}
	res, payload = env.do(t, "DELETE", "/api/families/"+familyID, map[string]any{
		"currentPassword": "adminpass123", "confirmName": "张家",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("删除家庭失败: %d %v", res.StatusCode, payload)
	}

	res, payload = env.postFile(t, "/api/backup/restore", admin, "site.zip", raw)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("整站还原失败: %d %v", res.StatusCode, payload)
	}
	families, err := env.store.ReadFamilies()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := families[familyID]; !ok {
		t.Fatalf("整站还原没有带回家庭清单: %v", families)
	}
	events, err := env.store.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if owner, _ := events[eventID]["familyId"].(string); owner != familyID {
		t.Fatalf("还原后账簿归属错误: %v", events[eventID])
	}
	// 原访问码仍可用，成员能看到这本账簿。
	cookie = env.loginFamily(t, "zhangjia2026", "")
	res, payload = env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK || len(payload["data"].(map[string]any)) != 1 {
		t.Fatalf("还原后家庭看不到自己的账簿: %d %v", res.StatusCode, payload)
	}
}

// 访问码强度：同一字符、连续序列、重复两段与常见弱口令都拒绝，正常码放行。
func TestFamilyCodeProblem(t *testing.T) {
	rejected := []string{"12345678", "abcdefgh", "87654321", "aaaaaaaa", "abcdabcd", "password", "admin123"}
	for _, code := range rejected {
		if familyCodeProblem(code) == "" {
			t.Fatalf("弱访问码应被拒绝: %s", code)
		}
	}
	accepted := []string{"zhangjia2026", "ZhangJia#2026", "my-family-code", "abcd1234efgh"}
	for _, code := range accepted {
		if problem := familyCodeProblem(code); problem != "" {
			t.Fatalf("正常访问码不应被拒绝: %s（%s）", code, problem)
		}
	}
	if familyCodeProblem("") != "" {
		t.Fatal("空码表示开放家庭，不应被强度校验拦下")
	}
}

// 服务器快照要能被管理员看到并下载，家庭成员看不到；家庭归档不算服务器快照。
func TestTrashSnapshotsVisibleAndDownloadable(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	trash := filepath.Join(env.dir, ".trash")
	snapshot := filepath.Join(trash, "import-20260101-120000")
	if err := os.MkdirAll(snapshot, 0o770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(snapshot, "events.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	// 家庭归档目录由「家庭归档」面板负责，不应出现在服务器快照里。
	archive := filepath.Join(trash, "family-张家-20260101-120000")
	if err := os.MkdirAll(archive, 0o770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(archive, "events.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	// 家庭名恰好叫 restore 时，归档目录名会撞上快照前缀；带 family.json 的一律归家庭归档。
	collision := filepath.Join(trash, "family-restore-20260101-120000")
	if err := os.MkdirAll(collision, 0o770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(collision, "family.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	res, payload := env.do(t, "GET", "/api/trash/snapshots", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("读取服务器快照失败: %d %v", res.StatusCode, payload)
	}
	list := payload["data"].([]any)
	if len(list) != 1 {
		t.Fatalf("只应列出导入快照: %v", list)
	}
	item := list[0].(map[string]any)
	if item["kind"] != "import" || item["files"].(float64) < 1 {
		t.Fatalf("快照信息不完整: %v", item)
	}
	res, raw := env.getBytes(t, "/api/trash/snapshots/"+item["name"].(string), admin)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("下载服务器快照失败: %d", res.StatusCode)
	}
	if _, ok := readZipFiles(t, raw)["events.json"]; !ok {
		t.Fatalf("下载的 zip 里没有原始文件: %v", raw[:20])
	}

	res, payload = env.do(t, "GET", "/api/trash/snapshots", nil, map[string]string{"Cookie": env.loginFamily(t, "", store.DefaultFamilyID)})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("家庭成员不应看到服务器快照: %d %v", res.StatusCode, payload)
	}
}

// 单家庭、没有管理员密码的旧部署：没设访问码时任何设备都能整站备份（升级前行为）；
// 一旦这个家庭设了访问码，整站备份就不能再绕过访问码。
func TestSingleFamilyAdminScope(t *testing.T) {
	env := newEnv(t)
	lan := func() *http.Request {
		req := httptest.NewRequest("GET", "/api/backup", nil)
		req.RemoteAddr = "10.10.10.50:5555"
		return req
	}
	if !env.api.isSiteAdmin(lan()) {
		t.Fatal("开放的单家庭部署应把局域网设备视为管理员（与升级前一致）")
	}

	salt := randomFamilyHex(16)
	if err := env.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		rec := families[store.DefaultFamilyID]
		rec["accessHash"] = hashFamilyCode("onlyfam2026", salt)
		rec["salt"] = salt
		families[store.DefaultFamilyID] = rec
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	if env.api.isSiteAdmin(lan()) {
		t.Fatal("家庭设了访问码后，不应再把整站备份交给未验证的局域网设备")
	}
	// 真正进入这个家庭（会话有效）就视为本站管理员：整站备份的内容本来就是这一家的。
	cookie := env.loginFamily(t, "onlyfam2026", "")
	withSession := lan()
	withSession.Header.Set("Cookie", cookie)
	if !env.api.isSiteAdmin(withSession) {
		t.Fatal("已进入该家庭会话的设备应能整站备份")
	}
	loop := httptest.NewRequest("GET", "/api/backup", nil)
	loop.RemoteAddr = "127.0.0.1:5555"
	if !env.api.isSiteAdmin(loop) {
		t.Fatal("本机回环仍应能管理")
	}
	// HTTP 层再确认一次：本机可以拿到整站备份。
	res, raw := env.getBytes(t, "/api/backup", "")
	if res.StatusCode != http.StatusOK || len(raw) < 100 {
		t.Fatalf("本机应能下载整站备份: %d", res.StatusCode)
	}
}

// 家庭还原会覆盖整家账簿，必须在家庭会话之外再验一次凭据。
func TestFamilyRestoreRequiresSecondFactor(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "张家", "accessCode": "zhangjia2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	zhangCookie := env.loginFamily(t, "zhangjia2026", "")
	res, raw := env.getBytes(t, "/api/family/backup", zhangCookie)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("下载家庭备份失败: %d", res.StatusCode)
	}
	// 只有家庭会话、没有重新输入访问码 → 拒绝。
	res, payload = env.postFile(t, "/api/family/backup/restore", zhangCookie, "z.zip", raw)
	if res.StatusCode != http.StatusForbidden || payload["code"] != "family_code" {
		t.Fatalf("没有二次验证应被拒绝: %d %v", res.StatusCode, payload)
	}
	res, payload = env.postFile(t, "/api/family/backup/restore", zhangCookie, "z.zip", raw, map[string]string{"X-Family-Code": "wrongcode2026"})
	if res.StatusCode != http.StatusForbidden || payload["code"] != "family_code" {
		t.Fatalf("访问码错误应被拒绝: %d %v", res.StatusCode, payload)
	}
	res, payload = env.postFile(t, "/api/family/backup/restore", zhangCookie, "z.zip", raw, map[string]string{"X-Family-Code": "zhangjia2026"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("带正确访问码应允许还原: %d %v", res.StatusCode, payload)
	}

	// 开放家庭没有可验证的凭据：普通成员不能还原。
	res, payload = env.do(t, "POST", "/api/families", map[string]any{"name": "开放家庭"}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建开放家庭失败: %d %v", res.StatusCode, payload)
	}
	openID := payload["data"].(map[string]any)["id"].(string)
	openCookie := env.loginFamily(t, "", openID)
	res, payload = env.postFile(t, "/api/family/backup/restore", openCookie, "z.zip", []byte("x"))
	if res.StatusCode != http.StatusForbidden || payload["code"] != "admin_required" {
		t.Fatalf("开放家庭成员不应能还原: %d %v", res.StatusCode, payload)
	}
}

// 单家庭、没有管理员密码的旧部署保持原样：那里本来就没有权限边界。
func TestFamilyRestoreAllowedOnLegacySingleFamily(t *testing.T) {
	env := newEnv(t)
	res, raw := env.getBytes(t, "/api/family/backup", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("下载家庭备份失败: %d", res.StatusCode)
	}
	res, payload := env.postFile(t, "/api/family/backup/restore", "", "f.zip", raw)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("单家庭部署应允许还原: %d %v", res.StatusCode, payload)
	}
}

// 同码会让用户被带进别人家：创建或改码时直接拒绝重复。
func TestDuplicateFamilyCodeRejected(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "甲家", "accessCode": "dupcode2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建甲家失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "POST", "/api/families", map[string]any{
		"name": "乙家", "accessCode": "dupcode2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusConflict || payload["code"] != "family_code_taken" {
		t.Fatalf("重复访问码应被拒绝: %d %v", res.StatusCode, payload)
	}
	// 自助换码也不能换成别人家的码。
	res, payload = env.do(t, "POST", "/api/families", map[string]any{
		"name": "乙家", "accessCode": "yijia2026x",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建乙家失败: %d %v", res.StatusCode, payload)
	}
	yiCookie := env.loginFamily(t, "yijia2026x", "")
	res, payload = env.do(t, "PUT", "/api/family/self", map[string]any{
		"currentCode": "yijia2026x", "newCode": "dupcode2026",
	}, map[string]string{"Cookie": yiCookie})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("换成别人家的访问码应被拒绝: %d %v", res.StatusCode, payload)
	}
}

// 修复前留下的重码家庭仍要能登进去：让用户选一次，而不是默认进第一个。
func TestAmbiguousFamilyCodeListsCandidates(t *testing.T) {
	env := newEnv(t)
	env.enableAdminPassword(t, "adminpass123")
	salt := randomFamilyHex(16)
	hash := hashFamilyCode("samecode2026", salt)
	now := time.Now().Format("2006-01-02 15:04:05")
	if err := env.store.WithFamilies(func(families map[string]store.Record) (bool, error) {
		families["fam_aaa"] = store.Record{"id": "fam_aaa", "name": "甲家", "createdAt": now + "-1", "accessHash": hash, "salt": salt}
		families["fam_bbb"] = store.Record{"id": "fam_bbb", "name": "乙家", "createdAt": now + "-2", "accessHash": hash, "salt": salt}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	res, payload := env.do(t, "POST", "/api/family/login", map[string]any{"accessCode": "samecode2026"}, nil)
	if res.StatusCode != http.StatusConflict || payload["code"] != "family_ambiguous" {
		t.Fatalf("重码登录应要求选择家庭: %d %v", res.StatusCode, payload)
	}
	candidates, _ := payload["data"].([]any)
	if len(candidates) != 2 {
		t.Fatalf("应返回两个候选家庭: %v", payload["data"])
	}
	res, payload = env.do(t, "POST", "/api/family/login", map[string]any{
		"accessCode": "samecode2026", "familyId": "fam_bbb",
	}, nil)
	if res.StatusCode != http.StatusOK || payload["data"].(map[string]any)["name"] != "乙家" {
		t.Fatalf("选定家庭后应能进入: %d %v", res.StatusCode, payload)
	}
}

// 删除家庭时，服务器上的家庭自动备份要跟着归档，不能继续留在 family-backups 下；
// 恢复归档时再挂回新家庭，而不是变成没人认领的孤儿目录。
func TestDeleteFamilyArchivesItsBackups(t *testing.T) {
	env := newEnv(t)
	admin := env.enableAdminPassword(t, "adminpass123")
	res, payload := env.do(t, "POST", "/api/families", map[string]any{
		"name": "有备份的家庭", "accessCode": "backupfam2026",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("创建家庭失败: %d %v", res.StatusCode, payload)
	}
	familyID := payload["data"].(map[string]any)["id"].(string)
	cookie := env.loginFamily(t, "backupfam2026", "")
	res, payload = env.do(t, "POST", "/api/events", map[string]any{
		"name": "要被归档的账簿", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("建账失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "PUT", "/api/autobackup", map[string]any{
		"enabled": true, "intervalHours": 24, "keep": 3,
		"familyEnabled": true, "familyKeep": 5,
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("保存自动备份设置失败: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "POST", "/api/autobackup/run", nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("立即备份失败: %d %v", res.StatusCode, payload)
	}
	familyBackups := filepath.Join(env.api.familyBackupsDir(), familyID)
	if entries, err := os.ReadDir(familyBackups); err != nil || len(entries) == 0 {
		t.Fatalf("家庭自动备份没有生成: %v", err)
	}

	res, payload = env.do(t, "DELETE", "/api/families/"+familyID, map[string]any{
		"currentPassword": "adminpass123", "confirmName": "有备份的家庭",
	}, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("删除家庭失败: %d %v", res.StatusCode, payload)
	}
	data := payload["data"].(map[string]any)
	if data["backups"] != true {
		t.Fatalf("删除结果应说明备份已归档: %v", data)
	}
	if _, err := os.Stat(familyBackups); !os.IsNotExist(err) {
		t.Fatalf("删除家庭后备份目录仍留在原处: %v", err)
	}
	archive := data["archive"].(string)
	archivedBackups := filepath.Join(env.dir, ".trash", archive, "family-backups")
	if entries, err := os.ReadDir(archivedBackups); err != nil || len(entries) == 0 {
		t.Fatalf("归档里没有带上家庭备份: %v", err)
	}

	res, payload = env.do(t, "POST", "/api/family/archives/restore/"+archive, nil, map[string]string{"Cookie": admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("恢复家庭归档失败: %d %v", res.StatusCode, payload)
	}
	restoredID := payload["data"].(map[string]any)["familyId"].(string)
	if entries, err := os.ReadDir(filepath.Join(env.api.familyBackupsDir(), restoredID)); err != nil || len(entries) == 0 {
		t.Fatalf("恢复后家庭备份没有挂回新家庭 %s: %v", restoredID, err)
	}
}
