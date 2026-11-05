package api

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
)

func b64(raw []byte) string { return base64.StdEncoding.EncodeToString(raw) }

func TestCipherUsable(t *testing.T) {
	v2 := append([]byte("GBv2"), make([]byte, 64)...)
	if !cipherUsable(b64(v2)) {
		t.Fatal("valid v2 rejected")
	}
	legacy := append([]byte("Salted__"), make([]byte, 40)...)
	if !cipherUsable(b64(legacy)) {
		t.Fatal("valid legacy rejected")
	}
	cases := map[string]string{
		"empty":        "",
		"not base64":   "!!!!",
		"v2 too short": b64(append([]byte("GBv2"), make([]byte, 16)...)),
		"bad padding":  b64(append([]byte("Salted__"), make([]byte, 33)...)),
		"plain text":   b64([]byte("hello world, definitely not encrypted")),
	}
	for name, value := range cases {
		if cipherUsable(value) {
			t.Fatalf("%s should be rejected", name)
		}
	}
}

func TestValidateCipherSizeLimit(t *testing.T) {
	huge := strings.Repeat("A", maxCipherSize+1)
	if err := validateCipher(huge); err == nil || !strings.Contains(err.Error(), "8MB") {
		t.Fatalf("expected size error, got %v", err)
	}
}

func TestValidateAmount(t *testing.T) {
	if v, err := validateAmount(float64(88.5), 1000, true); err != nil || v != 88.5 {
		t.Fatalf("valid amount rejected: %v %v", v, err)
	}
	if _, err := validateAmount(1000.01, 1000, true); err == nil {
		t.Fatal("over max accepted")
	}
	if _, err := validateAmount(-1, 1000, true); err == nil {
		t.Fatal("negative accepted")
	}
	if _, err := validateAmount(1.234, 1000, true); err == nil {
		t.Fatal("three decimals accepted")
	}
	if _, err := validateAmount("abc", 1000, true); err == nil {
		t.Fatal("string amount accepted")
	}
	// 整数值的浮点（1.10）允许两位以内
	if _, err := validateAmount(1.1, 1000, true); err != nil {
		t.Fatalf("1.1 rejected: %v", err)
	}
}

func TestValidateEventBodyRejectsBadInput(t *testing.T) {
	cases := []struct {
		name string
		body map[string]any
	}{
		{"empty name", map[string]any{"name": ""}},
		{"long name", map[string]any{"name": strings.Repeat("名", 121)}},
		{"bad theme", map[string]any{"theme": "theme-other"}},
		{"bad category", map[string]any{"category": "blue"}},
		{"bad style", map[string]any{"coverStyle": "UPPER CASE"}},
		{"bad image", map[string]any{"coverImage": "data:text/html;base64,xxx"}},
		{"bad date", map[string]any{"startDateTime": "2026-11-04 10:00"}},
		{"end before start", map[string]any{"startDateTime": "2026-11-05T10:00", "endDateTime": "2026-11-04T10:00"}},
		{"bad kdf", map[string]any{"kdf": map[string]any{"v": 2, "alg": "pbkdf2-sha256", "iter": 1, "salt": b64(make([]byte, 16))}}},
		{"bad hash", map[string]any{"passwordHash": "xyz"}},
	}
	for _, c := range cases {
		if err := validateEventBody(c.body, nil); err == nil {
			t.Fatalf("%s should fail", c.name)
		}
	}
}

func TestValidateEventBodyAcceptsRealisticPayload(t *testing.T) {
	salt := b64(make([]byte, 16))
	png := "data:image/png;base64,iVBORw0KGgo="
	body := map[string]any{
		"name":            "张三李四新婚之喜",
		"theme":           "theme-festive",
		"category":        "red",
		"coverStyle":      "shuangxi",
		"template":        "婚宴",
		"location":        "某某大酒店",
		"note":            "男方亲友",
		"startDateTime":   "2026-11-04T10:00",
		"endDateTime":     "2026-11-05T22:00",
		"minSpeechAmount": 100.0,
		"totalAmount":     8888.0,
		"voiceEnabled":    true,
		"coverImage":      png,
		"passwordHash":    strings.Repeat("a", 64),
		"kdf":             map[string]any{"v": 2.0, "alg": "pbkdf2-sha256", "iter": 310000.0, "salt": salt},
	}
	if err := validateEventBody(body, nil); err != nil {
		t.Fatalf("valid payload rejected: %v", err)
	}
}

func TestNextDisplayIDSkipsFour(t *testing.T) {
	got := []int{nextDisplayID(0), nextDisplayID(1), nextDisplayID(2), nextDisplayID(3), nextDisplayID(5)}
	want := []int{1, 2, 3, 5, 6}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
	if next := nextDisplayID(39); next != 50 {
		t.Fatalf("39 -> %d, want 50", next)
	}
}

func TestPad3(t *testing.T) {
	if pad3(7) != "007" || pad3(123) != "123" {
		t.Fatal("pad3 wrong")
	}
}

func sha256Sum(text string) [32]byte {
	sum := sha256.Sum256([]byte(text))
	return sum
}
