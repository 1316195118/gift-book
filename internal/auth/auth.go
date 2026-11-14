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
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	cookieName      = "ledger_auth"
	cookieLifetime  = 7 * 24 * time.Hour
	pbkdf2Rounds    = 210000
	minPasswordLen  = 8
	maxThrottleRows = 10000
)

// fileStamp 用「是否存在 + 大小 + 修改时间」判断磁盘文件是否变化。
type fileStamp struct {
	exists bool
	size   int64
	modNS  int64
}

func statFile(path string) fileStamp {
	info, err := os.Stat(path)
	if err != nil {
		return fileStamp{}
	}
	return fileStamp{exists: true, size: info.Size(), modNS: info.ModTime().UnixNano()}
}

// Manager 管理访问保护状态与防爆破记录。
// 状态与防爆破表在进程内缓存，按文件 stamp 失效：自身写入立即刷新缓存，
// 外部改动（例如手工替换配置文件）也能被下一次 stat 发现，不会读到过期状态。
type Manager struct {
	configDir  string
	trustProxy bool
	setupToken string
	mu         sync.Mutex

	stateCache  State
	stateStamp  fileStamp
	stateLoaded bool

	throttleCache  map[string]thrustRow
	throttleStamp  fileStamp
	throttleLoaded bool
}

// Options 是构造 Manager 的可选参数。
type Options struct {
	// TrustProxy 为 true 时才允许使用 X-Forwarded-For / X-Forwarded-Proto。
	// 仅在应用确实位于受信任的反向代理之后时开启；直接暴露时保持 false。
	TrustProxy bool
	// SetupToken 非空时，从「未开启访问保护」到「开启」这一步需要提供同样的口令，
	// 防止局域网内任何人抢先把访问保护打开并设置密码。留空则保持旧行为（无额外校验）。
	SetupToken string
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
	return NewWithOptions(configDir, Options{})
}

// NewWithOptions 创建访问保护管理器。
func NewWithOptions(configDir string, opts Options) (*Manager, error) {
	if err := os.MkdirAll(configDir, 0o775); err != nil {
		return nil, err
	}
	return &Manager{configDir: configDir, trustProxy: opts.TrustProxy, setupToken: opts.SetupToken}, nil
}

func (m *Manager) statePath() string    { return filepath.Join(m.configDir, "auth-state.json") }
func (m *Manager) throttlePath() string { return filepath.Join(m.configDir, "auth-throttle.json") }

// loadState 读取状态；文件存在但损坏或不可读时保持锁定，绝不退化为「未开启保护」。
// 调用方须持有 m.mu。
func (m *Manager) loadState() State {
	stamp := statFile(m.statePath())
	if m.stateLoaded && stamp == m.stateStamp {
		return m.stateCache
	}
	st := State{Iterations: pbkdf2Rounds}
	if stamp.exists {
		raw, err := os.ReadFile(m.statePath())
		if err != nil {
			st = State{Enabled: true, Iterations: pbkdf2Rounds, Unreadable: true}
		} else {
			var parsed State
			if err := json.Unmarshal(raw, &parsed); err != nil {
				st = State{Enabled: true, Iterations: pbkdf2Rounds, Unreadable: true}
			} else {
				st = parsed
				if st.Iterations <= 0 {
					st.Iterations = pbkdf2Rounds
				}
			}
		}
	}
	m.setCachedState(st, stamp)
	return st
}

// setCachedState 由写入路径调用，写完不必再解析一次文件。
// 调用方须持有 m.mu。
func (m *Manager) setCachedState(st State, stamp fileStamp) {
	m.stateCache = st
	m.stateStamp = stamp
	m.stateLoaded = true
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
	if err := os.Rename(tmp, m.statePath()); err != nil {
		return err
	}
	m.setCachedState(st, statFile(m.statePath()))
	return nil
}

// Enabled 报告是否开启了访问保护。
func (m *Manager) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.loadState().Enabled
}

// SetupTokenRequired 报告「开启访问保护」这一步是否需要额外口令。
func (m *Manager) SetupTokenRequired() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.setupToken != "" && !m.loadState().Enabled
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
		Secure:   m.isHTTPS(r),
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
		Secure:   m.isHTTPS(r),
	})
}

func (m *Manager) isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if !m.trustProxy {
		return false
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// ---- 修改访问保护设置 ----

// ErrWrongPassword 表示当前密码不正确。
var ErrWrongPassword = errors.New("wrong password")

// ErrTooWeak 表示新密码长度不足。
var ErrTooWeak = errors.New("password too weak")

// ErrSetupToken 表示开启访问保护所需的初始口令不正确或缺失。
var ErrSetupToken = errors.New("setup token required")

// UpdateRequest 描述一次访问保护设置变更。
type UpdateRequest struct {
	Enabled         bool
	Password        string
	CurrentPassword string
	SetupToken      string
}

// VerifyOrFail 校验密码并计入失败次数。返回的 retryAfter>0 表示已被锁定。
func (m *Manager) VerifyOrFail(r *http.Request, password string) (ok bool, fails int, retryAfter time.Duration) {
	ip := m.ClientIP(r)
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
		if !st.Enabled && m.setupToken != "" {
			if subtle.ConstantTimeCompare([]byte(m.setupToken), []byte(req.SetupToken)) != 1 {
				return ErrSetupToken
			}
		}
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

// 只有开启 TrustProxy 后才读取 X-Forwarded-For。
func (m *Manager) ClientIP(r *http.Request) string {
	if m.trustProxy {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			if idx := strings.IndexByte(fwd, ','); idx > 0 {
				return strings.TrimSpace(fwd[:idx])
			}
			return strings.TrimSpace(fwd)
		}
	}
	return remoteIP(r.RemoteAddr)
}

func remoteIP(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err == nil {
		return strings.Trim(host, "[]")
	}
	return addr
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
	if err := validateState(st); err != nil {
		return err
	}
	if st.Iterations <= 0 {
		st.Iterations = pbkdf2Rounds
	}
	st.Unreadable = false
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
	if err := os.Rename(tmp, m.statePath()); err != nil {
		return err
	}
	m.setCachedState(st, statFile(m.statePath()))
	return nil
}

// ValidateState 只校验备份里的访问保护状态是否合法，不落盘。
// 供导入备份时在写入数据前先行拒绝恶意配置。
func (m *Manager) ValidateState(raw []byte) error {
	var st State
	if err := json.Unmarshal(raw, &st); err != nil {
		return errors.New("访问保护状态损坏")
	}
	return validateState(st)
}

func validateState(st State) error {
	if st.Iterations != 0 && (st.Iterations < 100000 || st.Iterations > 10000000) {
		return errors.New("访问保护状态非法")
	}
	if st.Unreadable {
		return errors.New("访问保护状态不可用")
	}
	if st.Salt != "" {
		if _, err := base64.StdEncoding.DecodeString(st.Salt); err != nil {
			return errors.New("访问保护盐值非法")
		}
	}
	if st.Hash != "" {
		if _, err := base64.StdEncoding.DecodeString(st.Hash); err != nil {
			return errors.New("访问保护摘要非法")
		}
	}
	if st.Secret != "" {
		if _, err := hex.DecodeString(st.Secret); err != nil {
			return errors.New("访问保护会话密钥非法")
		}
	}
	if st.Enabled {
		if st.Salt == "" || st.Hash == "" || st.Secret == "" {
			return errors.New("访问保护状态不完整")
		}
	}
	return nil
}
