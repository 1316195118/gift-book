package api

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"giftbook/internal/ledger"
)

var base64Std = base64.StdEncoding

const maxCoverImageSize = 5 * 1024 * 1024
const maxImagePixels int64 = 25_000_000

var dateTimeLayout = "2006-01-02T15:04"

// nextDisplayID 从当前编号递增，跳过任何含 4 的号码。
func nextDisplayID(current int) int {
	next := current
	for {
		next++
		if !strings.Contains(strconv.Itoa(next), "4") {
			return next
		}
	}
}

func nowStamp() string { return time.Now().Format("2006-01-02 15:04:05") }

func validName(value string) bool {
	if value == "" || len(value) > 480 || !utf8.ValidString(value) {
		return false
	}
	if utf8.RuneCountInString(value) > 120 {
		return false
	}
	return strings.TrimSpace(value) != ""
}

func validDateTime(value string) bool {
	if len(value) != len("2006-01-02T15:04") {
		return false
	}
	parsed, err := time.ParseInLocation(dateTimeLayout, value, time.Local)
	if err != nil {
		return false
	}
	return parsed.Format(dateTimeLayout) == value
}

var coverStylePattern = regexp.MustCompile(`^[a-z0-9-]{0,32}$`)
var imagePattern = regexp.MustCompile(`^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]*)$`)

func validImage(value any) bool {
	if value == nil {
		return true
	}
	text, ok := value.(string)
	if !ok {
		return false
	}
	if text == "" {
		return true
	}
	if len(text) > maxCoverImageSize {
		return false
	}
	match := imagePattern.FindStringSubmatch(text)
	if match == nil || strings.TrimSpace(match[2]) == "" {
		return false
	}
	decoded, err := decodeBase64(strings.TrimSpace(match[2]))
	if err != nil || len(decoded) == 0 {
		return false
	}
	actualType, width, height, ok := imageInfo(decoded)
	if !ok || actualType != strings.ToLower(match[1]) || width <= 0 || height <= 0 {
		return false
	}
	return int64(width)*int64(height) <= maxImagePixels
}

// imageInfo 从真实图片头读取格式与尺寸，声明成 PNG 的 JPEG 或只有魔数的伪文件都会被拒绝。
func imageInfo(raw []byte) (format string, width, height int, ok bool) {
	if cfg, format, err := image.DecodeConfig(bytes.NewReader(raw)); err == nil {
		return format, cfg.Width, cfg.Height, true
	}
	width, height, ok = webPInfo(raw)
	if ok {
		return "webp", width, height, true
	}
	return "", 0, 0, false
}

// Go 标准库能识别 PNG/JPEG，但不能解码 WebP；这里只解析 WebP 容器中三种编码的尺寸头。
func webPInfo(raw []byte) (int, int, bool) {
	if len(raw) < 20 || string(raw[0:4]) != "RIFF" || string(raw[8:12]) != "WEBP" {
		return 0, 0, false
	}
	riffEnd := int64(binary.LittleEndian.Uint32(raw[4:8])) + 8
	if riffEnd < 20 || riffEnd > int64(len(raw)) {
		return 0, 0, false
	}
	for pos := 12; pos+8 <= int(riffEnd); {
		kind := string(raw[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(raw[pos+4 : pos+8]))
		start := pos + 8
		end := start + size
		if size < 0 || end > int(riffEnd) {
			return 0, 0, false
		}
		chunk := raw[start:end]
		switch kind {
		case "VP8X":
			if len(chunk) >= 10 {
				width := int(chunk[4]) | int(chunk[5])<<8 | int(chunk[6])<<16
				height := int(chunk[7]) | int(chunk[8])<<8 | int(chunk[9])<<16
				return width + 1, height + 1, true
			}
		case "VP8 ":
			if len(chunk) >= 10 && chunk[3] == 0x9d && chunk[4] == 0x01 && chunk[5] == 0x2a {
				width := int(binary.LittleEndian.Uint16(chunk[6:8]) & 0x3fff)
				height := int(binary.LittleEndian.Uint16(chunk[8:10]) & 0x3fff)
				return width, height, true
			}
		case "VP8L":
			if len(chunk) >= 5 && chunk[0] == 0x2f {
				bits := binary.LittleEndian.Uint32(chunk[1:5])
				return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, true
			}
		}
		pos = end + (size & 1)
	}
	return 0, 0, false
}

// validateAmount 把金额规范化为 float64，并做上下限与（可选）两位小数检查。
func validateAmount(value any, maximum float64, twoDecimals bool) (float64, error) {
	var number float64
	switch v := value.(type) {
	case float64:
		number = v
	case int:
		number = float64(v)
	case int64:
		number = float64(v)
	case json.Number:
		parsed, err := strconv.ParseFloat(string(v), 64)
		if err != nil {
			return 0, fmt.Errorf("无效的金额")
		}
		number = parsed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil {
			return 0, fmt.Errorf("无效的金额")
		}
		number = parsed
	default:
		return 0, fmt.Errorf("无效的金额")
	}
	if number < 0 || number > maximum {
		return 0, fmt.Errorf("金额超出允许范围")
	}
	if twoDecimals {
		scaled := number * 100
		if diff := scaled - float64(int64(scaled+0.5)); diff > 0.0000001 || diff < -0.0000001 {
			return 0, fmt.Errorf("金额最多保留两位小数")
		}
	}
	return number, nil
}

var textLimits = map[string]int{
	"voiceName":  160,
	"template":   120,
	"location":   200,
	"note":       4000,
	"coverStyle": 32,
}

// validateEventBody 校验并规范化写入账簿的字段。existing 用于合并校验时间范围。
func validateEventBody(body map[string]any, existing map[string]any) error {
	if raw, ok := body["name"]; ok {
		name, _ := raw.(string)
		if !validName(name) {
			return fmt.Errorf("名称不能为空且最多120个Unicode字符")
		}
	}
	if raw, ok := body["passwordHash"]; ok {
		hash, isString := raw.(string)
		if !isString {
			return fmt.Errorf("无效的密码摘要")
		}
		if hash != "" {
			if _, ok := ledger.NormalizeKey(hash); !ok {
				return fmt.Errorf("无效的密码摘要")
			}
		}
	}
	for field, limit := range textLimits {
		raw, ok := body[field]
		if !ok || raw == nil {
			continue
		}
		text, isString := raw.(string)
		if !isString || len(text) > limit*3 || !utf8.ValidString(text) {
			return fmt.Errorf("字段内容无效：%s", field)
		}
	}
	if raw, ok := body["theme"]; ok && raw != nil {
		theme, _ := raw.(string)
		if theme != "theme-festive" && theme != "theme-solemn" && theme != "theme-custom" {
			return fmt.Errorf("无效的主题")
		}
	}
	if raw, ok := body["category"]; ok && raw != nil {
		category, _ := raw.(string)
		if category != "red" && category != "white" && category != "custom" {
			return fmt.Errorf("无效的分类")
		}
	}
	for _, field := range []string{"coverImage", "qrcode"} {
		if raw, ok := body[field]; ok && !validImage(raw) {
			return fmt.Errorf("图片必须为不超过5MB的图片data URL或null")
		}
	}
	if raw, ok := body["kdf"]; ok && raw != nil {
		kdf, isMap := raw.(map[string]any)
		if !isMap {
			return fmt.Errorf("无效的加密参数")
		}
		version, _ := kdf["v"].(float64)
		alg, _ := kdf["alg"].(string)
		iter, iterOK := kdf["iter"].(float64)
		salt, _ := kdf["salt"].(string)
		decoded, decErr := decodeBase64(salt)
		if version != 2 || alg != "pbkdf2-sha256" || !iterOK || iter < 100000 || iter > 5000000 ||
			decErr != nil || len(decoded) != 16 {
			return fmt.Errorf("无效的加密参数")
		}
		body["kdf"] = map[string]any{"v": 2, "alg": "pbkdf2-sha256", "iter": iter, "salt": salt}
	}
	if raw, ok := body["coverStyle"]; ok && raw != nil {
		style, isString := raw.(string)
		if !isString || !coverStylePattern.MatchString(style) {
			return fmt.Errorf("无效的封面样式")
		}
	}
	if raw, ok := body["voiceEnabled"]; ok && raw != nil {
		if _, isBool := raw.(bool); !isBool {
			return fmt.Errorf("无效的语音播报开关")
		}
	}
	// 结簿归档：只允许布尔开关与短时间字符串，避免写入任意内容。
	if raw, ok := body["archived"]; ok && raw != nil {
		if _, isBool := raw.(bool); !isBool {
			return fmt.Errorf("无效的结簿状态")
		}
	}
	if raw, ok := body["archivedAt"]; ok && raw != nil {
		text, isString := raw.(string)
		if !isString || len(text) > 32 || !utf8.ValidString(text) {
			return fmt.Errorf("无效的结簿时间")
		}
	}
	if raw, ok := body["minSpeechAmount"]; ok && raw != nil {
		number, err := validateAmount(raw, 999999999999, true)
		if err != nil {
			return err
		}
		body["minSpeechAmount"] = number
	}
	if raw, ok := body["totalAmount"]; ok && raw != nil {
		number, err := validateAmount(raw, 9.0e15, false)
		if err != nil {
			return err
		}
		body["totalAmount"] = number
	}
	datesChanged := false
	for _, field := range []string{"startDateTime", "endDateTime"} {
		if raw, ok := body[field]; ok {
			datesChanged = true
			text, isString := raw.(string)
			if !isString || !validDateTime(text) {
				return fmt.Errorf("时间必须是有效的Y-m-dTH:i格式")
			}
		}
	}
	if datesChanged {
		combined := map[string]any{}
		for k, v := range existing {
			combined[k] = v
		}
		for k, v := range body {
			combined[k] = v
		}
		start, _ := combined["startDateTime"].(string)
		end, _ := combined["endDateTime"].(string)
		if start != "" && !validDateTime(start) {
			return fmt.Errorf("已有时间无效，请同时提交有效时间")
		}
		if end != "" && !validDateTime(end) {
			return fmt.Errorf("已有时间无效，请同时提交有效时间")
		}
		if start != "" && end != "" && start > end {
			return fmt.Errorf("开始时间不能晚于结束时间")
		}
	}
	return nil
}

func decodeBase64(text string) ([]byte, error) {
	return base64Std.DecodeString(text)
}
