// Package api 实现电子礼簿的 HTTP 接口。
package api

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// maxJSONBody 是单个 JSON 请求体的上限。
const maxJSONBody = 32 << 20

// response 与旧版接口保持一致：{success, data, message, code, duplicate}。
type response struct {
	Success   bool   `json:"success"`
	Data      any    `json:"data,omitempty"`
	Message   string `json:"message,omitempty"`
	Code      string `json:"code,omitempty"`
	Duplicate bool   `json:"duplicate,omitempty"`

	Authenticated *bool `json:"authenticated,omitempty"`
	Enabled       *bool `json:"enabled,omitempty"`
	SetupRequired *bool `json:"setupRequired,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, payload response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(payload)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, response{Success: false, Message: message})
}

func failCode(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, response{Success: false, Code: code, Message: message})
}

// sameOrigin 拒绝带 Origin 头的跨站写请求；无 Origin（curl、旧浏览器）照常放行。
// 默认只比主机名（与旧版一致）；开启 StrictOrigin 后要求 host:port 完全一致，
// 堵住同机另一端口的页面发简单请求跨站写。
func (s *Server) sameOrigin(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if origin == "null" {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	if s.strictOrigin {
		return strings.EqualFold(parsed.Host, r.Host)
	}
	// 兼容模式：比较主机名（忽略端口、IPv6 方括号），与旧版 PHP 的行为一致。
	return strings.EqualFold(parsed.Hostname(), requestHostname(r))
}

func requestHostname(r *http.Request) string {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return strings.Trim(host, "[]")
}

// decodeJSON 读取并校验请求体。传入 ResponseWriter 让 MaxBytesReader
// 在超限时终止读取并关闭连接；尾部多余内容一律拒绝，避免夹带第二份 JSON。
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody))
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("请求体包含多余内容")
		}
		return err
	}
	return nil
}
