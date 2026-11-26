// Package api 实现电子礼簿的 HTTP 接口。
package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// maxJSONBody 是单个 JSON 请求体的上限。
const maxJSONBody = 32 << 20
const minGzipJSONSize = 1024

// jsonCompressionWriter 只给 writeJSON 标记“客户端接受 gzip”，不改变普通响应写入。
type jsonCompressionWriter struct {
	http.ResponseWriter
}

func (w jsonCompressionWriter) wantsJSONCompression() bool { return true }

var jsonGzipPool = sync.Pool{
	New: func() any {
		zw, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
		return zw
	},
}

// response 与旧版接口保持一致：{success, data, message, code, duplicate}。
type response struct {
	Success   bool   `json:"success"`
	Data      any    `json:"data,omitempty"`
	Message   string `json:"message,omitempty"`
	Code      string `json:"code,omitempty"`
	Duplicate bool   `json:"duplicate,omitempty"`
	Warning   string `json:"warning,omitempty"`

	Authenticated *bool `json:"authenticated,omitempty"`
	Enabled       *bool `json:"enabled,omitempty"`
	SetupRequired *bool `json:"setupRequired,omitempty"`
	MultiFamily   *bool `json:"multiFamily,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, payload response) {
	var plain bytes.Buffer
	enc := json.NewEncoder(&plain)
	enc.SetEscapeHTML(false)
	err := enc.Encode(payload)
	if err != nil {
		http.Error(w, "响应生成失败", http.StatusInternalServerError)
		return
	}
	raw := plain.Bytes()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Vary", "Accept-Encoding")
	if compression, ok := w.(interface{ wantsJSONCompression() bool }); ok &&
		compression.wantsJSONCompression() && len(raw) >= minGzipJSONSize {
		var compressed bytes.Buffer
		compressed.Grow(len(raw) / 4)
		zw := jsonGzipPool.Get().(*gzip.Writer)
		zw.Reset(&compressed)
		_, writeErr := zw.Write(raw)
		closeErr := zw.Close()
		zw.Reset(io.Discard)
		jsonGzipPool.Put(zw)
		if writeErr == nil && closeErr == nil && compressed.Len() < len(raw) {
			raw = compressed.Bytes()
			w.Header().Set("Content-Encoding", "gzip")
		}
	}
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, response{Success: false, Message: message})
}

func failCode(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, response{Success: false, Code: code, Message: message})
}

// sameOrigin 拒绝带 Origin 头的跨站写请求；无 Origin（curl、旧浏览器）照常放行。
// 优先核对服务端看到的协议、主机和端口；反向代理改写这些信息时，
// 再接受浏览器明确标记为 same-origin 的请求，但仍拒绝 cross-site / same-site。
func (s *Server) sameOrigin(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return true
	}
	fetchSite := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")))
	if fetchSite == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	expected, expectedOK := parseOrigin(s.siteOrigin(r))
	actual, actualOK := parseOrigin(origin)
	if !expectedOK || !actualOK {
		return false
	}
	if expected == actual {
		return true
	}
	// HTTPS 反向代理通常会改写内部 Host 或协议，导致服务端看到的 origin
	// 与浏览器不同。该请求头由浏览器控制且页面脚本无法伪造，可证明前端与
	// API 在浏览器侧仍是同一 origin；cross-site 已在上面明确拒绝。
	return fetchSite == "same-origin"
}

type originParts struct {
	scheme string
	host   string
	port   string
}

// parseOrigin 规范化默认端口并按主机名大小写无关比较；路径、查询、用户信息一律拒绝。
func parseOrigin(raw string) (originParts, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.User != nil || parsed.Hostname() == "" ||
		parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return originParts{}, false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return originParts{}, false
	}
	port := parsed.Port()
	if port == "" {
		if scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return originParts{
		scheme: scheme,
		host:   strings.ToLower(strings.TrimSuffix(parsed.Hostname(), ".")),
		port:   port,
	}, true
}

// decodeJSON 读取并校验请求体。传入 ResponseWriter 让 MaxBytesReader
// 在超限时终止读取并关闭连接；尾部多余内容一律拒绝，避免夹带第二份 JSON。
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	defer r.Body.Close()
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
		return errors.New("请求必须使用 application/json")
	}
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
