package api

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"giftbook/internal/auth"
	"giftbook/internal/store"
	"giftbook/internal/update"
)

const noPassKey = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

func sha256Hex(text string) string {
	sum := sha256Sum(text)
	return hex.EncodeToString(sum[:])
}

type testEnv struct {
	server *httptest.Server
	store  *store.Store
	auth   *auth.Manager
	api    *Server
	dir    string
}

func newEnv(t *testing.T, extra ...Options) *testEnv {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	authMgr, err := auth.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	assets := fstest.MapFS{
		"index.html":  {Data: []byte("<!doctype html><title>app</title>")},
		"build.json":  {Data: []byte(`{"build":"test"}`)},
		"assets/x.js": {Data: []byte("console.log(1)")},
	}
	opts := Options{Store: st, Auth: authMgr, Assets: assets, Build: "test", Version: "2.4.58"}
	if len(extra) > 0 {
		opts.ForceHTTPS = extra[0].ForceHTTPS
		opts.PublicURL = extra[0].PublicURL
		opts.TrustProxy = extra[0].TrustProxy
	}
	srvAPI := New(opts)
	srv := httptest.NewServer(srvAPI.Handler())
	t.Cleanup(srvAPI.StopAutoBackup)
	t.Cleanup(srv.Close)
	return &testEnv{server: srv, store: st, auth: authMgr, api: srvAPI, dir: dir}
}

func (e *testEnv) do(t *testing.T, method, path string, body any, headers map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.server.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	// 测试请求视作本机：家庭管理接口在未开启站点访问保护时只允许回环地址。
	req.RemoteAddr = "127.0.0.1:12345"
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	_ = json.Unmarshal(raw, &payload)
	return res, payload
}

func (e *testEnv) createEvent(t *testing.T, name, key string) string {
	t.Helper()
	res, payload := e.do(t, "POST", "/api/events", map[string]any{
		"name": name, "passwordHash": key, "template": "婚宴",
	}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("create event: %d %v", res.StatusCode, payload)
	}
	data := payload["data"].(map[string]any)
	return data["id"].(string)
}

func validCipher(seed byte) string {
	raw := append([]byte("GBv2"), bytes.Repeat([]byte{seed}, 64)...)
	return base64.StdEncoding.EncodeToString(raw)
}

func TestStaticAndFallback(t *testing.T) {
	env := newEnv(t)
	for _, path := range []string{"/", "/index.html", "/terms", "/privacy"} {
		res, err := http.Get(env.server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || !strings.Contains(string(body), "doctype") {
			t.Fatalf("%s: %d %q", path, res.StatusCode, body)
		}
	}
	res, err := http.Get(env.server.URL + "/some/deep/route")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("未知页面状态码 = %d，期望 404", res.StatusCode)
	}
	res, _ = http.Get(env.server.URL + "/build.json")
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") && !strings.Contains(cc, "no-cache") {
		t.Fatalf("html cache header wrong: %s", cc)
	}
	res.Body.Close()

	res, _ = http.Get(env.server.URL + "/assets/x.js")
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Fatalf("asset cache header wrong: %s", cc)
	}
	res.Body.Close()

	res, _ = http.Get(env.server.URL + "/assets/missing.js")
	if res.StatusCode != 404 {
		t.Fatalf("missing asset: %d", res.StatusCode)
	}
	res.Body.Close()
}

func TestUnknownAPIReturnsJSON(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "GET", "/api/nope", nil, nil)
	if res.StatusCode != 404 || payload["success"] != false {
		t.Fatalf("got %d %v", res.StatusCode, payload)
	}
}

func TestCrossOriginWritesRejected(t *testing.T) {
	env := newEnv(t)
	body := map[string]any{"name": "x", "passwordHash": noPassKey}
	for _, origin := range []string{"null", "http://evil.example", "https://10.0.0.1:8099"} {
		res, _ := env.do(t, "POST", "/api/events", body, map[string]string{"Origin": origin})
		if res.StatusCode != http.StatusForbidden {
			t.Fatalf("origin %q should be rejected, got %d", origin, res.StatusCode)
		}
	}
	// 同源放行
	origin := strings.Replace(env.server.URL, "http://", "http://", 1)
	res, _ := env.do(t, "POST", "/api/events", body, map[string]string{"Origin": origin})
	if res.StatusCode != 200 {
		t.Fatalf("same origin rejected: %d", res.StatusCode)
	}

	// 协议、端口和浏览器跨站提示任一不符都拒绝。
	httpsOrigin := strings.Replace(env.server.URL, "http://", "https://", 1)
	res, _ = env.do(t, "POST", "/api/events", body, map[string]string{"Origin": httpsOrigin})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("same host with different scheme should be rejected, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/events", body, map[string]string{
		"Origin": origin, "Sec-Fetch-Site": "cross-site",
	})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("Sec-Fetch-Site cross-site should be rejected, got %d", res.StatusCode)
	}
}

// 反向代理改写 Host / X-Forwarded-Proto 时，浏览器明确标记的同源写请求仍应放行。
func TestSameOriginFetchAcceptedBehindRewritingProxy(t *testing.T) {
	env := newEnv(t)
	env.api.updater = update.New(env.dir, "2.4.58")
	body := map[string]any{"name": "proxy", "passwordHash": noPassKey}
	headers := map[string]string{
		"Origin":         "https://giftbook.example",
		"Sec-Fetch-Site": "same-origin",
	}
	res, payload := env.do(t, "POST", "/api/events", body, headers)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("浏览器同源请求应放行，实际 %d %v", res.StatusCode, payload)
	}

	res, payload = env.do(t, "PUT", "/api/update/settings", map[string]any{"proxy": ""}, headers)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("代理后的更新设置应放行，实际 %d %v", res.StatusCode, payload)
	}

	headers["Origin"] = "https://evil.example"
	headers["Sec-Fetch-Site"] = "cross-site"
	res, _ = env.do(t, "POST", "/api/events", body, headers)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("代理配置不能放行其他 origin，实际 %d", res.StatusCode)
	}

	headers["Origin"] = "https://giftbook.example"
	headers["Sec-Fetch-Site"] = "same-site"
	res, _ = env.do(t, "POST", "/api/events", body, headers)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("同站但不同 origin 应拒绝，实际 %d", res.StatusCode)
	}
}

func TestTrustedProxyMatchesForwardedOriginWithoutFetchMetadata(t *testing.T) {
	env := newEnv(t, Options{TrustProxy: true})
	body := map[string]any{"name": "forwarded proxy", "passwordHash": noPassKey}
	headers := map[string]string{
		"Origin":            "https://giftbook.example",
		"X-Forwarded-Host":  "giftbook.example",
		"X-Forwarded-Proto": "https",
	}
	res, payload := env.do(t, "POST", "/api/events", body, headers)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("可信代理的公开 Origin 应放行，实际 %d %v", res.StatusCode, payload)
	}

	headers["Origin"] = "https://evil.example"
	res, _ = env.do(t, "POST", "/api/events", body, headers)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("可信代理不能放行其他 Origin，实际 %d", res.StatusCode)
	}
}

func TestCrossOriginSensitiveWritesRejected(t *testing.T) {
	env := newEnv(t)
	cases := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodPost, "/api/auth", map[string]any{"password": "x"}},
		{http.MethodPut, "/api/auth", map[string]any{"enabled": false}},
		{http.MethodDelete, "/api/auth", nil},
		{http.MethodPut, "/api/update/settings", map[string]any{"proxy": ""}},
		{http.MethodPost, "/api/not-registered", map[string]any{"value": "x"}},
	}
	for _, test := range cases {
		res, _ := env.do(t, test.method, test.path, test.body, map[string]string{"Origin": "https://evil.example"})
		if res.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s 应拒绝跨站写入，实际 %d", test.method, test.path, res.StatusCode)
		}
	}
}

func TestEventLifecycle(t *testing.T) {
	env := newEnv(t)
	id := env.createEvent(t, "测试账簿", noPassKey)

	res, payload := env.do(t, "GET", "/api/events/"+id, nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get event: %d", res.StatusCode)
	}
	data := payload["data"].(map[string]any)
	if _, leaked := data["ledgerVerifier"]; leaked {
		t.Fatal("verifier leaked")
	}
	if data["hasPassword"] != false {
		t.Fatal("hasPassword wrong")
	}

	res, _ = env.do(t, "PUT", "/api/events/"+id, map[string]any{"totalAmount": 1200.5}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("update: %d", res.StatusCode)
	}

	res, _ = env.do(t, "DELETE", "/api/events/"+id, nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	res, payload = env.do(t, "GET", "/api/events", nil, nil)
	if len(payload["data"].(map[string]any)) != 0 {
		t.Fatal("event still listed")
	}
}

func TestEventListOmitsImagePayloads(t *testing.T) {
	env := newEnv(t)
	imageData := testPNGDataURL(t, 2, 2)
	res, payload := env.do(t, "POST", "/api/events", map[string]any{
		"name": "图片投影测试", "passwordHash": noPassKey,
		"coverImage": imageData, "qrcode": imageData,
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create event: %d %v", res.StatusCode, payload)
	}
	id := payload["data"].(map[string]any)["id"].(string)

	res, payload = env.do(t, "GET", "/api/events", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list events: %d", res.StatusCode)
	}
	listed := payload["data"].(map[string]any)[id].(map[string]any)
	for _, field := range []string{"coverImage", "qrcode"} {
		if _, exists := listed[field]; exists {
			t.Fatalf("event list leaked %s", field)
		}
	}

	res, payload = env.do(t, "GET", "/api/events/"+id, nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get event: %d", res.StatusCode)
	}
	detail := payload["data"].(map[string]any)
	for _, field := range []string{"coverImage", "qrcode"} {
		if detail[field] != imageData {
			t.Fatalf("single event lost %s", field)
		}
	}
}

func TestGiftFlowWithLedgerKey(t *testing.T) {
	env := newEnv(t)
	key := sha256Hex("secret-pass")
	id := env.createEvent(t, "有密码账簿", key)

	res, payload := env.do(t, "GET", "/api/gifts?eventId="+id, nil, nil)
	if res.StatusCode != http.StatusForbidden || payload["code"] != "ledger_key" {
		t.Fatalf("missing key should 403, got %d %v", res.StatusCode, payload)
	}

	headers := map[string]string{"X-Ledger-Key": key}
	cipher := validCipher(1)
	res, payload = env.do(t, "POST", "/api/gifts", map[string]any{
		"eventId": id, "encryptedContent": cipher, "requestId": "req-12345678",
	}, headers)
	if res.StatusCode != 200 {
		t.Fatalf("create gift: %d %v", res.StatusCode, payload)
	}
	giftID := payload["data"].(map[string]any)["id"].(string)

	// 幂等
	res, payload = env.do(t, "POST", "/api/gifts", map[string]any{
		"eventId": id, "encryptedContent": cipher, "requestId": "req-12345678",
	}, headers)
	if res.StatusCode != 200 || payload["duplicate"] != true {
		t.Fatalf("duplicate not detected: %v", payload)
	}

	// 乐观并发
	next := validCipher(2)
	res, payload = env.do(t, "PUT", "/api/gifts/"+giftID+"?eventId="+id, map[string]any{
		"eventId": id, "encryptedContent": next,
	}, headers)
	if res.StatusCode != http.StatusPreconditionRequired {
		t.Fatalf("missing ifMatch should 428, got %d %v", res.StatusCode, payload)
	}
	res, _ = env.do(t, "PUT", "/api/gifts/"+giftID+"?eventId="+id, map[string]any{
		"eventId": id, "encryptedContent": next, "ifMatch": sha256Hex("wrong"),
	}, headers)
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("ifMatch mismatch should 409, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "PUT", "/api/gifts/"+giftID+"?eventId="+id, map[string]any{
		"eventId": id, "encryptedContent": next, "ifMatch": sha256Hex(cipher),
	}, headers)
	if res.StatusCode != 200 {
		t.Fatalf("update gift: %d", res.StatusCode)
	}

	// 列表里没有明文字段
	res, payload = env.do(t, "GET", "/api/gifts?eventId="+id, nil, headers)
	data := payload["data"].(map[string]any)[giftID].(map[string]any)
	for _, field := range []string{"name", "amount", "giverName"} {
		if _, ok := data[field]; ok {
			t.Fatalf("%s leaked in gift payload", field)
		}
	}
}

func TestGiftRequiresExistingEvent(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "POST", "/api/gifts", map[string]any{
		"eventId": "doesnotexist", "encryptedContent": validCipher(1),
	}, nil)
	if res.StatusCode != 404 {
		t.Fatalf("got %d %v", res.StatusCode, payload)
	}
}

func TestInvalidIDsRejected(t *testing.T) {
	env := newEnv(t)
	for _, path := range []string{"/api/events/..%2Fetc", "/api/events/a%20b", "/api/gifts/..%2Fx"} {
		res, _ := env.do(t, "GET", path, nil, nil)
		if res.StatusCode < 400 {
			t.Fatalf("%s should be rejected, got %d", path, res.StatusCode)
		}
	}
}

func TestAccessProtectionFlow(t *testing.T) {
	env := newEnv(t)
	// 默认关闭
	res, payload := env.do(t, "GET", "/api/auth", nil, nil)
	if payload["enabled"] != false || payload["authenticated"] != true {
		t.Fatalf("default auth state: %v", payload)
	}

	// 开启：密码至少 8 位
	res, payload = env.do(t, "PUT", "/api/auth", map[string]any{"enabled": true, "password": "short"}, nil)
	if res.StatusCode != 400 {
		t.Fatalf("weak password accepted: %d %v", res.StatusCode, payload)
	}

	res, payload = env.do(t, "PUT", "/api/auth", map[string]any{"enabled": true, "password": "longenough1"}, nil)
	if res.StatusCode != 200 {
		t.Fatalf("enable auth: %d %v", res.StatusCode, payload)
	}

	// 访问保护现在是管理员入口：普通家庭接口仍可用，管理员接口必须登录。
	res, _ = env.do(t, "GET", "/api/events", nil, nil)
	if res.StatusCode != 200 {
		t.Fatalf("家庭接口不应被管理员密码拦截，got %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/families", nil, nil)
	if res.StatusCode != 403 {
		t.Fatalf("管理员接口未登录应返回 403，got %d", res.StatusCode)
	}

	// 错误密码
	res, _ = env.do(t, "POST", "/api/auth", map[string]any{"password": "wrong-pass"}, nil)
	if res.StatusCode != 401 {
		t.Fatalf("wrong password: %d", res.StatusCode)
	}

	// 正确密码签发 Cookie
	res, payload = env.do(t, "POST", "/api/auth", map[string]any{"password": "longenough1"}, nil)
	if res.StatusCode != 200 || payload["authenticated"] != true {
		t.Fatalf("login failed: %d %v", res.StatusCode, payload)
	}
	var cookie *http.Cookie
	for _, c := range res.Cookies() {
		if c.Name == "ledger_auth" {
			cookie = c
		}
	}
	if cookie == nil || cookie.Value == "" {
		t.Fatal("login cookie missing")
	}

	// 带 Cookie 访问管理员接口
	req, _ := http.NewRequest("GET", env.server.URL+"/api/families", nil)
	req.AddCookie(cookie)
	resAuthed, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resAuthed.StatusCode != 200 {
		t.Fatalf("cookie rejected: %d", resAuthed.StatusCode)
	}
	resAuthed.Body.Close()
}

func TestBackupRoundTrip(t *testing.T) {
	env := newEnv(t)
	id := env.createEvent(t, "备份账簿", noPassKey)
	headers := map[string]string{}
	env.do(t, "POST", "/api/gifts", map[string]any{
		"eventId": id, "encryptedContent": validCipher(3), "requestId": "req-backup-1",
	}, headers)

	res, err := http.Get(env.server.URL + "/api/backup")
	if err != nil {
		t.Fatal(err)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("content type %s", ct)
	}
	archive, _ := io.ReadAll(res.Body)
	res.Body.Close()

	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	names := map[string]bool{}
	for _, f := range reader.File {
		names[f.Name] = true
	}
	for _, want := range []string{"manifest.json", "data/events.json", "data/gifts_" + id + ".json"} {
		if !names[want] {
			t.Fatalf("backup missing %s (has %v)", want, names)
		}
	}

	// 清空后恢复
	env.do(t, "DELETE", "/api/events/"+id, nil, nil)
	_, payload := env.do(t, "GET", "/api/events", nil, nil)
	if len(payload["data"].(map[string]any)) != 0 {
		t.Fatal("event not deleted before restore")
	}

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, _ := writer.CreateFormFile("file", "backup.zip")
	part.Write(archive)
	writer.Close()
	res2, err := http.Post(env.server.URL+"/api/backup/restore", writer.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	var restored map[string]any
	json.NewDecoder(res2.Body).Decode(&restored)
	res2.Body.Close()
	if res2.StatusCode != 200 || restored["success"] != true {
		t.Fatalf("restore failed: %d %v", res2.StatusCode, restored)
	}
	_, payload = env.do(t, "GET", "/api/events", nil, nil)
	if _, ok := payload["data"].(map[string]any)[id]; !ok {
		t.Fatal("event not restored")
	}
	if env.store.CountGifts(id) != 1 {
		t.Fatal("gifts not restored")
	}
}

func TestRestoreRejectsGarbage(t *testing.T) {
	env := newEnv(t)
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, _ := writer.CreateFormFile("file", "x.zip")
	part.Write([]byte("not a zip"))
	writer.Close()
	res, err := http.Post(env.server.URL+"/api/backup/restore", writer.FormDataContentType(), &buf)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 400 {
		t.Fatalf("garbage accepted: %d", res.StatusCode)
	}
	res.Body.Close()
}

func TestPingAndBuild(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "GET", "/api/ping", nil, nil)
	if res.StatusCode != 200 || payload["pong"] != true {
		t.Fatalf("ping: %d %v", res.StatusCode, payload)
	}
	res, payload = env.do(t, "GET", "/api/build", nil, nil)
	if payload["data"].(map[string]any)["build"] != "test" {
		t.Fatalf("build: %v", payload)
	}
}

func TestSecurityHeaders(t *testing.T) {
	env := newEnv(t)
	res, _ := env.do(t, "GET", "/api/events", nil, nil)
	if res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("nosniff missing")
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("api cache header: %s", res.Header.Get("Cache-Control"))
	}
}

func TestPublicSEORoutes(t *testing.T) {
	env := newEnv(t, Options{PublicURL: "https://giftbook.example"})
	res, err := http.Get(env.server.URL + "/robots.txt")
	if err != nil {
		t.Fatal(err)
	}
	robots, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK ||
		!strings.Contains(string(robots), "Sitemap: https://giftbook.example/sitemap.xml") ||
		!strings.Contains(string(robots), "Disallow: /api/") {
		t.Fatalf("robots.txt 内容不正确: %d %q", res.StatusCode, robots)
	}

	res, err = http.Get(env.server.URL + "/sitemap.xml")
	if err != nil {
		t.Fatal(err)
	}
	sitemap, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK ||
		!strings.Contains(string(sitemap), "<loc>https://giftbook.example/</loc>") ||
		!strings.Contains(string(sitemap), "<loc>https://giftbook.example/privacy</loc>") ||
		!strings.Contains(string(sitemap), "<loc>https://giftbook.example/terms</loc>") {
		t.Fatalf("sitemap.xml 内容不正确: %d %q", res.StatusCode, sitemap)
	}
}

func TestForceHTTPSAndHSTS(t *testing.T) {
	env := newEnv(t, Options{ForceHTTPS: true})
	req := httptest.NewRequest(http.MethodGet, "http://giftbook.example/terms?from=http", nil)
	rec := httptest.NewRecorder()
	env.api.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("HTTP 应 308 跳转，实际 %d", rec.Code)
	}
	if got := rec.Header().Get("Location"); got != "https://giftbook.example/terms?from=http" {
		t.Fatalf("跳转地址 = %q", got)
	}

	health := httptest.NewRequest(http.MethodGet, "http://giftbook.example/api/ping", nil)
	health.RemoteAddr = "127.0.0.1:54321"
	healthRec := httptest.NewRecorder()
	env.api.Handler().ServeHTTP(healthRec, health)
	if healthRec.Code != http.StatusOK {
		t.Fatalf("容器本机健康检查不应被 HTTPS 跳转：%d", healthRec.Code)
	}

	secure := httptest.NewRequest(http.MethodGet, "https://giftbook.example/", nil)
	secureRec := httptest.NewRecorder()
	env.api.Handler().ServeHTTP(secureRec, secure)
	if got := secureRec.Header().Get("Strict-Transport-Security"); got != "max-age=31536000" {
		t.Fatalf("HSTS = %q", got)
	}
}

func TestGuestHoneypotAndRuneLimits(t *testing.T) {
	env := newEnv(t)
	id := env.createEvent(t, "宾客校验", noPassKey)
	res, payload := env.do(t, "POST", "/api/events/"+id+"/guest", map[string]any{"enabled": true}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("enable guest: %d %v", res.StatusCode, payload)
	}
	token := payload["data"].(map[string]any)["token"].(string)

	res, _ = env.do(t, "POST", "/api/guest/"+token+"/gifts", map[string]any{
		"name": "机器人", "amount": 100, "website": "https://spam.example",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("honeypot 应静默成功，实际 %d", res.StatusCode)
	}
	pending, err := env.store.GuestInbox(id)
	if err != nil || len(pending) != 0 {
		t.Fatalf("honeypot 内容不应落库: %v %v", pending, err)
	}

	// 长度按 Unicode 字符计算；旧实现使用字节长度，会误伤六个以上汉字。
	res, _ = env.do(t, "POST", "/api/guest/"+token+"/gifts", map[string]any{
		"name": "欧阳娜娜欧阳娜娜欧阳娜娜", "amount": 888,
		"relation": "亲友", "note": "祝万事顺意",
	}, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("12 个汉字的姓名应通过，实际 %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/guest/"+token+"/gifts", map[string]any{
		"name": strings.Repeat("礼", 21), "amount": 100,
	}, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("超过 20 字的姓名应拒绝，实际 %d", res.StatusCode)
	}
}

func TestGuestRateLimiter(t *testing.T) {
	limiter := newGuestRateLimiter()
	if ok, _ := limiter.allow("guest", 2, 40*time.Millisecond); !ok {
		t.Fatal("第一次请求应放行")
	}
	if ok, _ := limiter.allow("guest", 2, 40*time.Millisecond); !ok {
		t.Fatal("第二次请求应放行")
	}
	if ok, retry := limiter.allow("guest", 2, 40*time.Millisecond); ok || retry <= 0 {
		t.Fatalf("超过上限应拒绝并返回重试时间: ok=%v retry=%v", ok, retry)
	}
	time.Sleep(55 * time.Millisecond)
	if ok, _ := limiter.allow("guest", 2, 40*time.Millisecond); !ok {
		t.Fatal("滑动窗口过期后应重新放行")
	}
}

// 单本账簿导出必须是一个完整可解压的 zip，且长度头与实际内容一致。
func TestExportEventZipIsComplete(t *testing.T) {
	env := newEnv(t)
	id := env.createEvent(t, "导出测试", noPassKey)
	res, err := http.Get(env.server.URL + "/api/events/" + id + "/export")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("export status %d", res.StatusCode)
	}
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := res.Header.Get("Content-Length"), itoa(len(raw)); got != want {
		t.Fatalf("Content-Length = %q, want %q", got, want)
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("导出的不是完整 zip: %v", err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	for _, want := range []string{"manifest.json", "data/events.json", "data/gifts_" + id + ".json"} {
		if !names[want] {
			t.Fatalf("导出包缺少 %s，实际条目 %v", want, names)
		}
	}
}

// 备份文件名校验：只认 auto- 开头的 zip，三处接口共用同一套规则。
func TestAutoBackupNameValidation(t *testing.T) {
	for _, name := range []string{"auto-20261106-180900.zip", "auto-test-a.zip"} {
		if !safeBackupName(name) {
			t.Fatalf("应允许 %q", name)
		}
	}
	for _, name := range []string{"", "backup.zip", "auto-20261106.zip.bak", "../auto-x.zip", "auto-../x.zip", `auto-x\y.zip`} {
		if safeBackupName(name) {
			t.Fatalf("应拒绝 %q", name)
		}
	}
	env := newEnv(t)
	res, _ := env.do(t, "DELETE", "/api/autobackup/file/backup.zip", nil, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("删除非自动备份应返回 400，实际 %d", res.StatusCode)
	}
}

// Origin 默认就要求 host:port 完全一致，不再依赖可选环境变量。
func TestOriginPortMustMatch(t *testing.T) {
	body := map[string]any{"name": "x", "passwordHash": noPassKey}
	otherPort := map[string]string{"Origin": "http://127.0.0.1:1"}

	env := newEnv(t)
	res, _ := env.do(t, "POST", "/api/events", body, otherPort)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("应拒绝不同端口，实际 %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/events", body, map[string]string{"Origin": env.server.URL})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("同源应放行，实际 %d", res.StatusCode)
	}
}

// 外部替换状态文件后，进程内缓存必须失效，不能一直用旧状态。
func TestStateCacheSeesExternalChange(t *testing.T) {
	env := newEnv(t)
	if env.auth.Enabled() {
		t.Fatal("初始应为未开启保护")
	}
	state := `{"enabled":true,"iterations":210000,"salt":"YQ==","hash":"Yg==","secret":"ab"}`
	if err := os.WriteFile(filepath.Join(env.dir, "auth-state.json"), []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}
	if !env.auth.Enabled() {
		t.Fatal("外部修改状态文件后缓存应失效")
	}
}

// 请求体里夹带第二份 JSON 应被拒绝。
func TestDecodeJSONRejectsTrailingPayload(t *testing.T) {
	env := newEnv(t)
	body := `{"name":"x","passwordHash":"` + noPassKey + `"} {"extra":1}`
	req, err := http.NewRequest(http.MethodPost, env.server.URL+"/api/events", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("尾部多余 JSON 应返回 400，实际 %d", res.StatusCode)
	}
}

func TestJSONWritesRequireJSONContentType(t *testing.T) {
	env := newEnv(t)
	body := `{"name":"x","passwordHash":"` + noPassKey + `"}`
	req, err := http.NewRequest(http.MethodPost, env.server.URL+"/api/events", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "text/plain")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("非 JSON 写请求应返回 400，实际 %d", res.StatusCode)
	}
}

// 停止后台定时备份应立即返回，不能还卡在长达数小时的 Sleep 里。
func TestStopAutoBackupReturns(t *testing.T) {
	env := newEnv(t)
	env.api.StartAutoBackup()
	done := make(chan struct{})
	go func() {
		env.api.StopAutoBackup()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("StopAutoBackup 未及时返回")
	}
}

// 定时器与「立即备份」并发时，同名临时文件不能互相踩，产出的 zip 必须完整。
func TestConcurrentAutoBackup(t *testing.T) {
	env := newEnv(t)
	const n = 6
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() { errs <- env.api.runAutoBackup() }()
	}
	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("runAutoBackup: %v", err)
		}
	}
	dir := filepath.Join(env.dir, "backups")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	zips := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("残留临时文件 %s", e.Name())
		}
		if !strings.HasSuffix(e.Name(), ".zip") {
			continue
		}
		zips++
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw))); err != nil {
			t.Fatalf("备份包 %s 损坏: %v", e.Name(), err)
		}
	}
	if zips == 0 {
		t.Fatal("没有生成任何备份")
	}
}
