// Package auth 实现可选的整站访问保护、登录防爆破与 Cookie 签发。
package auth

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	cookieName     = "ledger_auth"
	cookieLifetime = 7 * 24 * time.Hour
	pbkdf2Rounds   = 210000
	minPasswordLen = 8
)

// Manager 管理访问保护状态与防爆破记录。
type Manager struct {
	configDir string
	mu        sync.Mutex
}

// State 是持久化的访问保护状态。
type State struct {
	Enabled    bool   `json:"enabled"`
	Iterations int    `json:"iterations"`
	Salt       string `json:"salt"`
	Hash       string `json:"hash"`
	Secret     string `json:"secret"`
	Unreadable bool   `json:"unreadable,omitempty"`
}

// New 创建访问保护管理器。
func New(configDir string) (*Manager, error) {
	if err := os.MkdirAll(configDir, 0o775); err != nil {
		return nil, err
	}
	return &Manager{configDir: configDir}, nil
}

func (m *Manager) statePath() string    { return filepath.Join(m.configDir, "auth-state.json") }
func (m *Manager) throttlePath() string { return filepath.Join(m.configDir, "auth-throttle.json") }

// loadState 读取状态；文件存在但损坏时保持锁定，绝不退化为“未开启保护”。
func (m *Manager) loadState() State {
	raw, err := os.ReadFile(m.statePath())
	if err != nil {
		return State{Iterations: pbkdf2Rounds}
	}
	var st State
	if err := json.Unmarshal(raw, &st); err != nil {
		return State{Enabled: true, Iterations: pbkdf2Rounds, Unreadable: true}
	}
	if st.Iterations <= 0 {
		st.Iterations = pbkdf2Rounds
	}
	return st
}

func (m *Manager) saveState(st State) error {
	payload, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.statePath() + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.statePath())
}

// Enabled 报告是否开启了访问保护。
func (m *Manager) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.loadState().Enabled
}

// Unreadable 报告状态文件是否损坏。
func (m *Manager) Unreadable() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.loadState().Unreadable
}

// VerifyPassword 校验访问密码。
func (m *Manager) VerifyPassword(password string) bool {
	if password == "" {
		return false
	}
	m.mu.Lock()
	st := m.loadState()
	m.mu.Unlock()
	return verifyAgainst(st, password)
}

func verifyAgainst(st State, password string) bool {
	if st.Salt == "" || st.Hash == "" {
		return false
	}
	salt, err := base64.StdEncoding.DecodeString(st.Salt)
	if err != nil {
		return false
	}
	expected, err := base64.StdEncoding.DecodeString(st.Hash)
	if err != nil {
		return false
	}
	derived, err := pbkdf2.Key(sha256.New, password, salt, st.Iterations, 32)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(expected, derived) == 1
}

// Check 报告当前请求是否已通过访问保护。
func (m *Manager) Check(r *http.Request) bool {
	m.mu.Lock()
	st := m.loadState()
	m.mu.Unlock()
	if !st.Enabled {
		return true
	}
	if st.Secret == "" {
		return false
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	idx := strings.IndexByte(cookie.Value, '.')
	if idx <= 0 {
		return false
	}
	expiry := cookie.Value[:idx]
	signature := cookie.Value[idx+1:]
	secs, err := strconv.ParseInt(expiry, 10, 64)
	if err != nil || time.Now().Unix() >= secs {
		return false
	}
	mac := hmac.New(sha256.New, []byte(st.Secret))
	mac.Write([]byte(expiry))
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(signature))
}

// SetCookie 签发登录 Cookie。
func (m *Manager) SetCookie(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	st := m.loadState()
	m.mu.Unlock()
	if st.Secret == "" {
		return
	}
	expiry := time.Now().Add(cookieLifetime).Unix()
	payload := strconv.FormatInt(expiry, 10)
	mac := hmac.New(sha256.New, []byte(st.Secret))
	mac.Write([]byte(payload))
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    payload + "." + hex.EncodeToString(mac.Sum(nil)),
		Path:     "/",
		Expires:  time.Unix(expiry, 0),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPS(r),
	})
}

// ClearCookie 清除登录 Cookie。
func (m *Manager) ClearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   isHTTPS(r),
	})
}

func isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// ---- 修改访问保护设置 ----

// ErrWrongPassword 表示当前密码不正确。
var ErrWrongPassword = errors.New("wrong password")

// ErrTooWeak 表示新密码长度不足。
var ErrTooWeak = errors.New("password too weak")

// UpdateRequest 描述一次访问保护设置变更。
type UpdateRequest struct {
	Enabled         bool
	Password        string
	CurrentPassword string
}

// VerifyOrFail 校验密码并计入失败次数。返回的 retryAfter>0 表示已被锁定。
func (m *Manager) VerifyOrFail(r *http.Request, password string) (ok bool, fails int, retryAfter time.Duration) {
	ip := ClientIP(r)
	m.mu.Lock()
	defer m.mu.Unlock()
	th := m.throttleStatus(ip)
	if th.Until > time.Now().Unix() {
		return false, 0, time.Until(time.Unix(th.Until, 0))
	}
	st := m.loadState()
	if verifyAgainst(st, password) {
		m.throttleClear(ip)
		return true, 0, 0
	}
	th = m.throttleFail(ip)
	if th.Until > time.Now().Unix() {
		return false, 0, time.Until(time.Unix(th.Until, 0))
	}
	return false, th.Fails, 0
}

// Update 应用访问保护设置变更。
func (m *Manager) Update(r *http.Request, req UpdateRequest) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := m.loadState()
	if st.Unreadable {
		return errors.New("访问保护状态文件无法读取，请先检查配置目录权限")
	}
	if st.Enabled && req.CurrentPassword != "" && !verifyAgainst(st, req.CurrentPassword) {
		return ErrWrongPassword
	}
	if req.Enabled {
		if st.Enabled && req.Password == "" {
			// 保持现有密码不变，仅轮换会话密钥并续签 Cookie。
			st.Secret = newSecret()
			return m.saveState(st)
		}
		if req.Password == "" {
			return errors.New("开启访问保护需要设置密码")
		}
		if len([]rune(req.Password)) < minPasswordLen {
			return ErrTooWeak
		}
		salt := make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return err
		}
		derived, err := pbkdf2.Key(sha256.New, req.Password, salt, pbkdf2Rounds, 32)
		if err != nil {
			return err
		}
		st.Enabled = true
		st.Salt = base64.StdEncoding.EncodeToString(salt)
		st.Hash = base64.StdEncoding.EncodeToString(derived)
		st.Iterations = pbkdf2Rounds
		st.Secret = newSecret()
		return m.saveState(st)
	}
	st.Enabled = false
	st.Secret = newSecret()
	return m.saveState(st)
}

func newSecret() string {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

// ---- 防爆破 ----

// thrustRow 是单个 IP 的失败计数。
type thrustRow struct {
	Fails   int   `json:"fails"`
	Until   int64 `json:"until"`
	Strikes int   `json:"strikes"`
	Last    int64 `json:"last"`
}

func (m *Manager) readThrottle() map[string]thrustRow {
	out := map[string]thrustRow{}
	raw, err := os.ReadFile(m.throttlePath())
	if err != nil {
		return out
	}
	_ = json.Unmarshal(raw, &out)
	return out
}

func (m *Manager) writeThrottle(data map[string]thrustRow) {
	payload, err := json.Marshal(data)
	if err != nil {
		return
	}
	tmp := m.throttlePath() + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, m.throttlePath())
}

func (m *Manager) throttleStatus(ip string) thrustRow {
	row, ok := m.readThrottle()[ip]
	if !ok {
		return thrustRow{}
	}
	return row
}

func (m *Manager) throttleFail(ip string) thrustRow {
	data := m.readThrottle()
	row := data[ip]
	now := time.Now().Unix()
	if now-row.Last > 900 {
		row.Fails = 0
		row.Strikes = 0
	}
	row.Fails++
	row.Last = now
	if row.Fails >= 5 {
		row.Strikes++
		if row.Strikes > 6 {
			row.Strikes = 6
		}
		lock := 60 * (1 << (row.Strikes - 1))
		if lock > 1800 {
			lock = 1800
		}
		row.Until = now + int64(lock)
		row.Fails = 0
	}
	data[ip] = row
	for key, item := range data {
		if now-item.Last > 86400 {
			delete(data, key)
		}
	}
	m.writeThrottle(data)
	return row
}

func (m *Manager) throttleClear(ip string) {
	data := m.readThrottle()
	if _, ok := data[ip]; ok {
		delete(data, ip)
		m.writeThrottle(data)
	}
}

// ThrottleLocked 报告该来源当前是否处于锁定中。
func (m *Manager) ThrottleLocked(ip string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.throttleStatus(ip).Until > time.Now().Unix()
}

// ThrottleRetryAfter 返回剩余锁定时间。
func (m *Manager) ThrottleRetryAfter(ip string) time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := m.throttleStatus(ip)
	left := time.Until(time.Unix(row.Until, 0))
	if left < 0 {
		return 0
	}
	return left
}

// ThrottleFail 记录一次失败并返回当前失败次数。
func (m *Manager) ThrottleFail(ip string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.throttleFail(ip).Fails
}

// ThrottleClear 清空该来源的失败记录。
func (m *Manager) ThrottleClear(ip string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.throttleClear(ip)
}

// ThrottleFails 返回当前累计失败次数（含锁定前）。
func (m *Manager) ThrottleFails(ip string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := m.throttleStatus(ip)
	if row.Fails > 0 {
		return row.Fails
	}
	// 刚触发锁定时计数已清零，按阈值返回，提示语才对。
	if row.Until > time.Now().Unix() {
		return 5
	}
	return 0
}

// ClientIP 返回请求来源 IP。
func ClientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if idx := strings.IndexByte(fwd, ','); idx > 0 {
			return strings.TrimSpace(fwd[:idx])
		}
		return strings.TrimSpace(fwd)
	}
	host := r.RemoteAddr
	if idx := strings.LastIndexByte(host, ':'); idx > 0 {
		return host[:idx]
	}
	return host
}

// ExportState 返回用于整库备份的访问保护状态（不含防爆破记录）。
func (m *Manager) ExportState() []byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	raw, err := os.ReadFile(m.statePath())
	if err != nil {
		return nil
	}
	var st State
	if err := json.Unmarshal(raw, &st); err != nil || st.Unreadable {
		return nil
	}
	return raw
}

// ImportState 用备份里的状态替换当前访问保护设置。
func (m *Manager) ImportState(raw []byte) error {
	var st State
	if err := json.Unmarshal(raw, &st); err != nil {
		return err
	}
	if st.Iterations <= 0 {
		st.Iterations = pbkdf2Rounds
	}
	payload, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	tmp := m.statePath() + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.statePath())
}
