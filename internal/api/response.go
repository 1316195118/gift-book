// Package api 实现电子礼簿的 HTTP 接口。
package api

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// response 与旧版接口保持一致：{success, data, message, code, duplicate}。
type response struct {
	Success   bool   `json:"success"`
	Data      any    `json:"data,omitempty"`
	Message   string `json:"message,omitempty"`
	Code      string `json:"code,omitempty"`
	Duplicate bool   `json:"duplicate,omitempty"`

	Authenticated *bool `json:"authenticated,omitempty"`
	Enabled       *bool `json:"enabled,omitempty"`
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
func sameOrigin(r *http.Request) bool {
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
	// 比较主机名（忽略端口、IPv6 方括号），与旧版 PHP 的行为一致。
	return strings.EqualFold(parsed.Hostname(), requestHostname(r))
}

func requestHostname(r *http.Request) string {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return strings.Trim(host, "[]")
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 32<<20))
	return dec.Decode(dst)
}
