package auth

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newManager(t *testing.T) *Manager {
	t.Helper()
	m, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return m
}

func enable(t *testing.T, m *Manager, password string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/auth", nil)
	if err := m.Update(req, UpdateRequest{Enabled: true, Password: password}); err != nil {
		t.Fatalf("开启访问保护失败: %v", err)
	}
}

func TestDisabledByDefault(t *testing.T) {
	m := newManager(t)
	if m.Enabled() {
		t.Fatal("默认应为未开启")
	}
	if !m.Check(httptest.NewRequest(http.MethodGet, "/", nil)) {
		t.Fatal("未开启保护时 Check 应放行")
	}
}

func TestEnableAndVerifyPassword(t *testing.T) {
	m := newManager(t)
	enable(t, m, "secret-123")
	if !m.Enabled() {
		t.Fatal("应已开启")
	}
	if !m.VerifyPassword("secret-123") {
		t.Fatal("正确密码应通过")
	}
	if m.VerifyPassword("wrong-pass") {
		t.Fatal("错误密码不应通过")
	}
	if m.VerifyPassword("") {
		t.Fatal("空密码不应通过")
	}
}

func TestWeakPasswordRejected(t *testing.T) {
	m := newManager(t)
	req := httptest.NewRequest(http.MethodPut, "/api/auth", nil)
	err := m.Update(req, UpdateRequest{Enabled: true, Password: "short"})
	if !errors.Is(err, ErrTooWeak) {
		t.Fatalf("期望 ErrTooWeak，得到 %v", err)
	}
}

func TestCookieSession(t *testing.T) {
	m := newManager(t)
	enable(t, m, "secret-123")

	rec := httptest.NewRecorder()
	m.SetCookie(rec, httptest.NewRequest(http.MethodPost, "/api/auth", nil))
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("应签发登录 Cookie")
	}

	authed := httptest.NewRequest(http.MethodGet, "/", nil)
	authed.AddCookie(cookies[0])
	if !m.Check(authed) {
		t.Fatal("有效 Cookie 应通过")
	}
	if m.Check(httptest.NewRequest(http.MethodGet, "/", nil)) {
		t.Fatal("无 Cookie 不应通过")
	}

	tampered := httptest.NewRequest(http.MethodGet, "/", nil)
	tampered.AddCookie(&http.Cookie{Name: cookieName, Value: cookies[0].Value + "0"})
	if m.Check(tampered) {
		t.Fatal("篡改签名不应通过")
	}
}

func TestVerifyOrFailLocksAfterRepeatedFailures(t *testing.T) {
	m := newManager(t)
	enable(t, m, "secret-123")
	req := httptest.NewRequest(http.MethodPost, "/api/auth", nil)
	req.RemoteAddr = "192.0.2.10:3456"

	if ok, _, _ := m.VerifyOrFail(req, "secret-123"); !ok {
		t.Fatal("正确密码应立即通过")
	}

	locked := false
	for i := 0; i < 8; i++ {
		ok, _, retry := m.VerifyOrFail(req, "bad-pass")
		if ok {
			t.Fatal("错误密码不应通过")
		}
		if retry > 0 {
			locked = true
			break
		}
	}
	if !locked {
		t.Fatal("连续失败后应触发锁定")
	}
	if !m.ThrottleLocked("192.0.2.10") {
		t.Fatal("锁定状态应可查询")
	}
	if m.ThrottleRetryAfter("192.0.2.10") <= 0 {
		t.Fatal("锁定剩余时间应大于 0")
	}
}

func TestClientIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.10:3456"
	req.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")

	direct, err := NewWithOptions(t.TempDir(), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := direct.ClientIP(req); got != "192.0.2.10" {
		t.Fatalf("未信任代理时应取 RemoteAddr，得到 %s", got)
	}

	proxied, err := NewWithOptions(t.TempDir(), Options{TrustProxy: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := proxied.ClientIP(req); got != "203.0.113.9" {
		t.Fatalf("信任代理时应取 XFF 首个地址，得到 %s", got)
	}
}

func TestValidateStateRejectsInvalid(t *testing.T) {
	m := newManager(t)
	cases := []string{
		"not-json",
		`{"enabled":true}`,
		`{"enabled":true,"salt":"!!!","hash":"AAAA","secret":"00"}`,
		`{"iterations":1}`,
		`{"unreadable":true}`,
	}
	for _, raw := range cases {
		if err := m.ValidateState([]byte(raw)); err == nil {
			t.Fatalf("应拒绝非法状态: %s", raw)
		}
	}
	if err := m.ValidateState([]byte(`{"enabled":false,"iterations":210000}`)); err != nil {
		t.Fatalf("合法状态不应报错: %v", err)
	}
}

func TestUpdateRejectsWrongCurrentPassword(t *testing.T) {
	m := newManager(t)
	enable(t, m, "secret-123")
	req := httptest.NewRequest(http.MethodPut, "/api/auth", nil)
	err := m.Update(req, UpdateRequest{Enabled: true, Password: "new-secret-1", CurrentPassword: "bad-pass"})
	if !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("期望 ErrWrongPassword，得到 %v", err)
	}
}
