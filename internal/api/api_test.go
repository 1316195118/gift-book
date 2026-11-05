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
	"strings"
	"testing"
	"testing/fstest"

	"giftbook/internal/auth"
	"giftbook/internal/store"
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
}

func newEnv(t *testing.T) *testEnv {
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
	handler := New(Options{Store: st, Auth: authMgr, Assets: assets, Build: "test", Version: "2.0.0"}).Handler()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return &testEnv{server: srv, store: st, auth: authMgr}
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
	for _, path := range []string{"/", "/index.html", "/some/deep/route"} {
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
	res, _ := http.Get(env.server.URL + "/build.json")
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
	// 同源（含端口差异）放行
	origin := strings.Replace(env.server.URL, "http://", "http://", 1)
	res, _ := env.do(t, "POST", "/api/events", body, map[string]string{"Origin": origin})
	if res.StatusCode != 200 {
		t.Fatalf("same origin rejected: %d", res.StatusCode)
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

	// 未登录访问接口
	res, _ = env.do(t, "GET", "/api/events", nil, nil)
	if res.StatusCode != 401 {
		t.Fatalf("should require login, got %d", res.StatusCode)
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

	// 带 Cookie 访问
	req, _ := http.NewRequest("GET", env.server.URL+"/api/events", nil)
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
