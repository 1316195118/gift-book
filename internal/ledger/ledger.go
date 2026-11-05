// Package ledger 实现单本账簿「管理密码」的服务端校验。
//
// 浏览器用管理密码在本地加解密礼金，服务端只保存 HMAC-SHA256(SHA-256(密码), 每本随机盐)，
// 请求头 X-Ledger-Key 携带 SHA-256(密码)。接口从不回传任何可离线比对的摘要。
package ledger

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

// NoPassKey 是 SHA-256("")，旧版本用它表示“没有管理密码”。
const NoPassKey = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

var keyPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// NormalizeKey 把请求或旧数据里的密钥规范化为小写 64 位十六进制；
// 空值表示无密码账簿，非法格式返回 ok=false。
func NormalizeKey(value string) (key string, ok bool) {
	if value == "" {
		return NoPassKey, true
	}
	if len(value) != 64 {
		return "", false
	}
	lower := make([]byte, 64)
	for i := 0; i < 64; i++ {
		c := value[i]
		switch {
		case c >= 'A' && c <= 'F':
			lower[i] = c + ('a' - 'A')
		case c >= 'a' && c <= 'f', c >= '0' && c <= '9':
			lower[i] = c
		default:
			return "", false
		}
	}
	return string(lower), true
}

// ValidKey 报告 header 里的密钥格式是否合法。
func ValidKey(value string) bool { return keyPattern.MatchString(value) }

// VerifierFields 生成新账簿的校验字段。
func VerifierFields(key string) map[string]any {
	salt := randomHex(16)
	return map[string]any{
		"hasPassword":    key != NoPassKey,
		"ledgerSalt":     salt,
		"ledgerVerifier": hmacHex(key, salt),
	}
}

// HasPassword 报告账簿是否设置了管理密码（兼容旧 passwordHash 字段）。
func HasPassword(event map[string]any) bool {
	if _, ok := event["ledgerVerifier"]; ok {
		if _, ok2 := event["ledgerSalt"]; ok2 {
			v, _ := event["hasPassword"].(bool)
			return v
		}
	}
	raw, _ := event["passwordHash"].(string)
	key, ok := NormalizeKey(raw)
	if !ok {
		return true
	}
	return key != NoPassKey
}

// Matches 校验请求携带的密钥是否匹配账簿。
func Matches(event map[string]any, key string) bool {
	if !HasPassword(event) {
		return true
	}
	if key == "" {
		return false
	}
	verifier, ok := event["ledgerVerifier"].(string)
	if ok {
		if salt, ok2 := event["ledgerSalt"].(string); ok2 {
			return hmac.Equal([]byte(verifier), []byte(hmacHex(key, salt)))
		}
	}
	// 尚未迁移的旧记录：直接与旧摘要比对。
	raw, _ := event["passwordHash"].(string)
	legacy, ok := NormalizeKey(raw)
	return ok && hmac.Equal([]byte(legacy), []byte(key))
}

// Migrate 把旧 passwordHash 就地转换为加盐校验值，返回是否有改动。
func Migrate(event map[string]any) (changed bool, ok bool) {
	if _, hasVerifier := event["ledgerVerifier"]; hasVerifier {
		if _, hasSalt := event["ledgerSalt"]; hasSalt {
			if _, hasLegacy := event["passwordHash"]; hasLegacy {
				delete(event, "passwordHash")
				return true, true
			}
			return false, true
		}
	}
	raw, _ := event["passwordHash"].(string)
	key, valid := NormalizeKey(raw)
	if !valid {
		// 无法识别的旧摘要：原样保留，访问时按钥匙错误处理，不擅自开放。
		return false, false
	}
	delete(event, "passwordHash")
	for k, v := range VerifierFields(key) {
		event[k] = v
	}
	return true, true
}

// Public 去掉所有校验材料，只给出 hasPassword。
func Public(event map[string]any) map[string]any {
	out := make(map[string]any, len(event)+1)
	for k, v := range event {
		out[k] = v
	}
	out["hasPassword"] = HasPassword(event)
	delete(out, "passwordHash")
	delete(out, "ledgerVerifier")
	delete(out, "ledgerSalt")
	return out
}

func hmacHex(key, salt string) string {
	mac := hmac.New(sha256.New, []byte(salt))
	mac.Write([]byte(key))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable")
	}
	return hex.EncodeToString(buf)
}
