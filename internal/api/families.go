package api

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"giftbook/internal/store"
)

// 家庭空间：一个部署里可以有多个家庭，每个家庭只看到自己的账簿。
// 访问码只决定「能看到哪些账簿」，账簿内容仍由每本账簿自己的管理密码解密。
const (
	familyCookieName   = "ledger_family"
	familyCookieMaxAge = 30 * 24 * 3600
	familyCodeRounds   = 120000
	familyMinCodeLen   = 8
)

type familyInfo struct {
	ID               string
	Name             string
	AccessHash       string
	Salt             string
	CreatedAt        string
	Archived         bool
	SessionEpoch     int
	LastBackupAt     string
	LastAutoBackupAt string
}

type familyPublic struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	CreatedAt        string `json:"createdAt"`
	EventCount       int    `json:"eventCount,omitempty"`
	HasCode          bool   `json:"hasCode"`
	Admin            bool   `json:"admin,omitempty"`
	IsDefault        bool   `json:"isDefault,omitempty"`
	LastBackupAt     string `json:"lastBackupAt,omitempty"`
	LastAutoBackupAt string `json:"lastAutoBackupAt,omitempty"`
	LastActiveAt     string `json:"lastActiveAt,omitempty"`
	// BackupAlert 只给管理员：自动备份失败或长时间没跑时，首页设置卡直接提示。
	BackupAlert string `json:"backupAlert,omitempty"`
}

func familyEpoch(rec store.Record) int {
	switch value := rec["sessionEpoch"].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case string:
		n, _ := strconv.Atoi(value)
		return n
	}
	return 0
}

func bumpFamilyEpoch(rec store.Record) {
	rec["sessionEpoch"] = familyEpoch(rec) + 1
}

func familyFromRecord(id string, rec store.Record) familyInfo {
	name, _ := rec["name"].(string)
	hash, _ := rec["accessHash"].(string)
	salt, _ := rec["salt"].(string)
	created, _ := rec["createdAt"].(string)
	archived, _ := rec["archived"].(bool)
	lastBackup, _ := rec["lastBackupAt"].(string)
	lastAuto, _ := rec["lastAutoBackupAt"].(string)
	return familyInfo{
		ID: id, Name: name, AccessHash: hash, Salt: salt, CreatedAt: created,
		Archived: archived, SessionEpoch: familyEpoch(rec),
		LastBackupAt: lastBackup, LastAutoBackupAt: lastAuto,
	}
}

func (f familyInfo) public() familyPublic {
	return familyPublic{
		ID:               f.ID,
		Name:             f.Name,
		CreatedAt:        f.CreatedAt,
		HasCode:          f.AccessHash != "",
		IsDefault:        f.ID == store.DefaultFamilyID,
		LastBackupAt:     f.LastBackupAt,
		LastAutoBackupAt: f.LastAutoBackupAt,
	}
}

func randomFamilyHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable")
	}
	return hex.EncodeToString(buf)
}

func hashFamilyCode(code, salt string) string {
	derived, err := pbkdf2.Key(sha256.New, code, []byte(salt), familyCodeRounds, 32)
	if err != nil {
		return ""
	}
	return hex.EncodeToString(derived)
}

func familyCodeMatches(f familyInfo, code string) bool {
	if f.AccessHash == "" {
		return true
	}
	if code == "" {
		return false
	}
	expected := hashFamilyCode(code, f.Salt)
	return expected != "" && subtle.ConstantTimeCompare([]byte(expected), []byte(f.AccessHash)) == 1
}

// familyCodeTaken 检查访问码是否已被其它家庭占用。
// 访问码是加盐哈希，无法直接比较，只能逐个家庭重新派生一次；
// 创建家庭、重置访问码、成员自助换码都是低频操作，这点开销可以接受。
func (s *Server) familyCodeTaken(families map[string]store.Record, exceptID, code string) bool {
	if code == "" {
		return false
	}
	for id, rec := range families {
		if id == exceptID {
			continue
		}
		candidate := familyFromRecord(id, rec)
		if candidate.Archived || candidate.AccessHash == "" {
			continue
		}
		if familyCodeMatches(candidate, code) {
			return true
		}
	}
	return false
}

// 家庭访问码一旦被猜到，这个家庭的账簿名称与全部礼金密文就都能被下载，
// 代价远高于记住一个稍长的码，所以对「同一字符重复 / 连续序列 / 重复两段 / 常见弱口令」直接拒绝。
var weakFamilyCodes = map[string]bool{
	"password": true, "passw0rd": true, "12345678": true, "123456789": true,
	"1234567890": true, "87654321": true, "qwerty123": true, "qwertyui": true,
	"abc12345": true, "admin123": true, "giftbook": true, "woaini1314": true,
	"5201314520": true, "a1234567": true, "11111111": true, "88888888": true,
}

// familyCodeProblem 返回访问码不合规的原因；空字符串表示可用（空码 = 开放家庭，由调用方判断）。
func familyCodeProblem(code string) string {
	if code == "" {
		return ""
	}
	runes := []rune(code)
	if len(runes) < familyMinCodeLen {
		return "家庭访问码至少 8 位"
	}
	if len(runes) > 128 {
		return "家庭访问码不能超过 128 位"
	}
	same := true
	for _, r := range runes[1:] {
		if r != runes[0] {
			same = false
			break
		}
	}
	if same {
		return "访问码不能是同一个字符重复，请换一个"
	}
	if step := runes[1] - runes[0]; step == 1 || step == -1 {
		sequential := true
		for i := 2; i < len(runes); i++ {
			if runes[i]-runes[i-1] != step {
				sequential = false
				break
			}
		}
		if sequential {
			return "访问码不能是连续的数字或字母，请换一个"
		}
	}
	if len(runes)%2 == 0 {
		half := len(runes) / 2
		if string(runes[:half]) == string(runes[half:]) {
			return "访问码不能是重复的两段，请换一个"
		}
	}
	if weakFamilyCodes[strings.ToLower(code)] {
		return "这个访问码太常见，请换一个"
	}
	return ""
}

// familySecret 是家庭会话 Cookie 的签名密钥，首次使用时生成并落到配置目录。
func (s *Server) familySecret() []byte {
	s.familySecretOnce.Do(func() {
		dir := s.configDir
		if dir == "" {
			dir = s.store.Dir()
		}
		path := filepath.Join(dir, "family-secret")
		if raw, err := os.ReadFile(path); err == nil && len(raw) >= 32 {
			s.familySecretKeyBytes = raw[:32]
			return
		}
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			panic("crypto/rand unavailable")
		}
		_ = os.MkdirAll(dir, 0o775)
		_ = os.WriteFile(path, key, 0o600)
		s.familySecretKeyBytes = key
	})
	return s.familySecretKeyBytes
}

func (s *Server) familyCookieValue(id string, epoch int) string {
	exp := time.Now().Add(familyCookieMaxAge * time.Second).Unix()
	payload := id + "." + strconv.Itoa(epoch) + "." + strconv.FormatInt(exp, 10)
	mac := hmac.New(sha256.New, s.familySecret())
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) verifyFamilyCookie(value string) (string, int, bool) {
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return "", 0, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", 0, false
	}
	fields := strings.Split(string(raw), ".")
	// 老 Cookie 是 id.exp；新 Cookie 是 id.epoch.exp。
	if len(fields) != 2 && len(fields) != 3 {
		return "", 0, false
	}
	epoch := 0
	expIndex := len(fields) - 1
	if len(fields) == 3 {
		epoch, err = strconv.Atoi(fields[1])
		if err != nil {
			return "", 0, false
		}
	}
	exp, err := strconv.ParseInt(fields[expIndex], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return "", 0, false
	}
	mac := hmac.New(sha256.New, s.familySecret())
	mac.Write(raw)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return "", 0, false
	}
	return fields[0], epoch, true
}

func (s *Server) setFamilyCookie(w http.ResponseWriter, r *http.Request, id string, epoch int) {
	http.SetCookie(w, &http.Cookie{
		Name:     familyCookieName,
		Value:    s.familyCookieValue(id, epoch),
		Path:     "/",
		MaxAge:   familyCookieMaxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
}

// 主动退出时留下一个无效哨兵值，而不是直接删 Cookie：
// 删掉后 requests 会命中「默认家庭自动进入」的回退逻辑，反而退不出去。
func (s *Server) clearFamilyCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     familyCookieName,
		Value:    "out",
		Path:     "/",
		MaxAge:   familyCookieMaxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

// resolveFamily 解析当前请求的家庭。
//   - 有合法 Cookie：按 Cookie；
//   - 没有 Cookie：默认家庭且未设访问码时自动进入（兼容升级前的单家庭部署）；
//   - Cookie 存在但无效（例如主动退出）：不再回退默认家庭，交给前端显示家庭门。
func (s *Server) resolveFamily(r *http.Request) (familyInfo, bool) {
	families, err := s.store.ReadFamilies()
	if err != nil || len(families) == 0 {
		return familyInfo{}, false
	}
	if cookie, err := r.Cookie(familyCookieName); err == nil {
		if id, epoch, ok := s.verifyFamilyCookie(cookie.Value); ok {
			if rec, exists := families[id]; exists {
				family := familyFromRecord(id, rec)
				// epoch 不匹配说明访问码改过或管理员强制下线，旧 Cookie 立即失效。
				if !family.Archived && family.SessionEpoch == epoch {
					return family, true
				}
			}
		}
		return familyInfo{}, false
	}
	// 只有一个家庭（升级前的单家庭部署）时保持直接进入；
	// 一旦存在多个家庭，第一次访问必须先经过家庭门选择，否则会默认落进「我的家庭」。
	if len(families) == 1 {
		if rec, ok := families["fam_default"]; ok {
			family := familyFromRecord("fam_default", rec)
			if !family.Archived && family.AccessHash == "" {
				return family, true
			}
		}
	}
	return familyInfo{}, false
}

func (s *Server) requireFamily(w http.ResponseWriter, r *http.Request) (familyInfo, bool) {
	family, ok := s.resolveFamily(r)
	if !ok {
		failCode(w, http.StatusUnauthorized, "family_required", "请选择家庭并输入访问码")
		return familyInfo{}, false
	}
	return family, true
}

func familyIDOf(event map[string]any) string {
	id, _ := event["familyId"].(string)
	return id
}

// 升级前的账簿没有 familyId，一律视为默认家庭。
func eventBelongsTo(event map[string]any, familyID string) bool {
	id := familyIDOf(event)
	if id == "" {
		id = "fam_default"
	}
	return id == familyID
}

func (s *Server) familyCount() int {
	families, err := s.store.ReadFamilies()
	if err != nil {
		return 0
	}
	return len(families)
}

// isSiteAdmin：开启访问保护时认站点登录；未开启时只允许本机回环地址管理家庭。
// 例外是「只有一个家庭、没有管理员密码」的旧部署：那时没有跨家庭数据，
// 任何能打开本站的人都相当于本站管理员，和升级前一致，否则手机会突然失去整站备份入口。
// 这个家庭一旦设了访问码，访问码就是唯一的凭据：只有真正进入这个家庭（会话有效）
// 才算管理员，不能让整站备份绕过访问码。
func (s *Server) isSiteAdmin(r *http.Request) bool {
	if s.auth.Enabled() {
		return s.auth.Check(r)
	}
	if families, err := s.store.ReadFamilies(); err == nil && len(families) <= 1 {
		if len(families) == 0 {
			return true
		}
		for id, rec := range families {
			family := familyFromRecord(id, rec)
			if family.AccessHash == "" {
				return true
			}
			if r == nil {
				return false
			}
			if cookie, cookieErr := r.Cookie(familyCookieName); cookieErr == nil {
				if cid, epoch, ok := s.verifyFamilyCookie(cookie.Value); ok &&
					cid == id && family.SessionEpoch == epoch {
					return true
				}
			}
		}
	}
	ip := s.auth.ClientIP(r)
	return ip == "127.0.0.1" || ip == "::1"
}

// requireGlobalBackup：多家庭模式下，整站备份/还原只允许站点管理员，
// 否则家庭用户可以下载到其它家庭的数据。
func (s *Server) requireGlobalBackup(w http.ResponseWriter, r *http.Request) bool {
	if s.isSiteAdmin(r) {
		return true
	}
	failCode(w, http.StatusForbidden, "family_scope", "整站备份仅站点管理员可用；家庭成员请使用「家庭备份」")
	return false
}

// adminUnlocked：已用管理员密码登录的管理员，可跨家庭进入而不需要家庭访问码。
// 只在访问保护真正开启时生效，避免「本机回环」被误当成管理员。
func (s *Server) adminUnlocked(r *http.Request) bool {
	return s.auth.Enabled() && s.auth.Check(r)
}

// requireFamilyRestore 给「家庭还原」补一层二次验证：还原会用备份覆盖本家庭全部账簿
// （包括设了管理密码的那几本），只凭一个还没过期的家庭会话就能清空数据风险太高。
//   - 站点管理员已登录：直接放行，和整站还原一致；
//   - 单家庭且没有管理员密码（升级前的部署）：保持原有行为，此时本来就没有权限边界；
//   - 有访问码的家庭：重新输一次访问码，防止拿到一台已登录设备就能还原；
//   - 开放家庭：没有可验证的凭据，只能由管理员操作。
func (s *Server) requireFamilyRestore(w http.ResponseWriter, r *http.Request, family familyInfo) bool {
	if s.adminUnlocked(r) {
		return true
	}
	if !s.auth.Enabled() && s.familyCount() <= 1 {
		return true
	}
	if family.AccessHash == "" {
		failCode(w, http.StatusForbidden, "admin_required", "开放家庭没有访问码可验证，还原需要管理员登录")
		return false
	}
	code := strings.TrimSpace(r.Header.Get("X-Family-Code"))
	ip := "family-restore:" + s.auth.ClientIP(r)
	if s.auth.ThrottleLocked(ip) {
		retry := s.auth.ThrottleRetryAfter(ip)
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
		failCode(w, http.StatusTooManyRequests, "family_locked",
			"访问码错误次数过多，请 "+strconv.Itoa(int(retry.Minutes())+1)+" 分钟后再试")
		return false
	}
	if familyCodeMatches(family, code) {
		s.auth.ThrottleClear(ip)
		return true
	}
	if code != "" {
		s.auth.ThrottleFail(ip)
	}
	failCode(w, http.StatusForbidden, "family_code", "还原会覆盖本家庭全部账簿，请重新输入家庭访问码")
	return false
}

// initFamilies 在启动时创建默认家庭，并把升级前的账簿归入默认家庭。
func (s *Server) initFamilies() {
	families, err := s.store.ReadFamilies()
	if err != nil {
		log.Printf("家庭数据读取失败: %v", err)
		return
	}
	if len(families) == 0 {
		now := time.Now().Format("2006-01-02 15:04:05")
		rec := store.Record{"id": "fam_default", "name": "我的家庭", "createdAt": now}
		if err := s.store.WithFamilies(func(current map[string]store.Record) (bool, error) {
			if len(current) > 0 {
				return false, nil
			}
			current["fam_default"] = rec
			return true, nil
		}); err != nil {
			log.Printf("默认家庭创建失败: %v", err)
			return
		}
	}
	if err := s.store.WithEvents(func(events map[string]store.Record) (bool, error) {
		changed := false
		for _, event := range events {
			if familyIDOf(event) == "" {
				event["familyId"] = "fam_default"
				changed = true
			}
		}
		return changed, nil
	}); err != nil {
		log.Printf("账簿家庭归属迁移失败: %v", err)
	}
}
