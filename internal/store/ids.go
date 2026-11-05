package store

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"strings"
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ValidID 报告 id 是否可以直接用于文件名。
func ValidID(id string) bool { return idPattern.MatchString(id) }

// SanitizeID 去掉 id 中所有非文件名字符，用于拼接路径时的兜底。
func SanitizeID(id string) string {
	var b strings.Builder
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "unknown"
	}
	return b.String()
}

// NewID 生成 24 位十六进制随机 ID（与旧版 bin2hex(random_bytes(12)) 一致）。
func NewID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return hex.EncodeToString(buf)
}

func randomSuffix() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}
