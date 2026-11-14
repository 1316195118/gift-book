package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// 静态资源压缩与缓存头：Vary 必须在「未压缩」响应上也带，
// 否则共享缓存可能把 gzip 内容发给未声明 Accept-Encoding 的客户端。
func TestStaticGzipAndVary(t *testing.T) {
	big := []byte(strings.Repeat("body { color: red; }\n", 100)) // > 1024，可压缩
	assets := fstest.MapFS{
		"index.html":     {Data: []byte("<!doctype html><title>app</title>")},
		"assets/big.css": {Data: big},
		"assets/tiny.js": {Data: []byte("var a=1;")},                    // 太小，不压缩
		"assets/pic.png": {Data: bytes.Repeat([]byte{0x89, 0x50}, 900)}, // 二进制，不压缩
	}
	h := (&Server{assets: assets}).staticHandler()

	request := func(path, encoding, method string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if encoding != "" {
			r.Header.Set("Accept-Encoding", encoding)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}

	t.Run("未声明 gzip 也要带 Vary", func(t *testing.T) {
		w := request("/assets/big.css", "", http.MethodGet)
		if w.Code != http.StatusOK {
			t.Fatalf("状态码 = %d", w.Code)
		}
		if got := w.Header().Get("Content-Encoding"); got != "" {
			t.Fatalf("不应压缩，Content-Encoding = %q", got)
		}
		if got := w.Header().Get("Vary"); got != "Accept-Encoding" {
			t.Fatalf("Vary = %q，期望 Accept-Encoding", got)
		}
		if !bytes.Equal(w.Body.Bytes(), big) {
			t.Fatal("响应体与源文件不一致")
		}
	})

	t.Run("声明 gzip 时压缩且可还原", func(t *testing.T) {
		w := request("/assets/big.css", "gzip", http.MethodGet)
		if w.Header().Get("Content-Encoding") != "gzip" {
			t.Fatal("未返回 gzip")
		}
		if w.Header().Get("Vary") != "Accept-Encoding" {
			t.Fatal("gzip 响应缺少 Vary")
		}
		if w.Body.Len() >= len(big) {
			t.Fatalf("压缩后没有变小：%d >= %d", w.Body.Len(), len(big))
		}
		zr, err := gzip.NewReader(bytes.NewReader(w.Body.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		defer zr.Close()
		out, err := io.ReadAll(zr)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(out, big) {
			t.Fatal("解压后内容与源文件不一致")
		}
	})

	t.Run("小文件不压缩也不带 Vary", func(t *testing.T) {
		w := request("/assets/tiny.js", "gzip", http.MethodGet)
		if w.Header().Get("Content-Encoding") != "" || w.Header().Get("Vary") != "" {
			t.Fatalf("小文件不应进入压缩分支：enc=%q vary=%q",
				w.Header().Get("Content-Encoding"), w.Header().Get("Vary"))
		}
	})

	t.Run("二进制不压缩也不带 Vary", func(t *testing.T) {
		w := request("/assets/pic.png", "gzip", http.MethodGet)
		if w.Header().Get("Content-Encoding") != "" || w.Header().Get("Vary") != "" {
			t.Fatalf("图片不应压缩：enc=%q vary=%q",
				w.Header().Get("Content-Encoding"), w.Header().Get("Vary"))
		}
	})

	t.Run("HEAD 不写响应体", func(t *testing.T) {
		w := request("/assets/big.css", "gzip", http.MethodHead)
		if w.Body.Len() != 0 {
			t.Fatalf("HEAD 不应有响应体，实际 %d 字节", w.Body.Len())
		}
		if w.Header().Get("Content-Length") == "" {
			t.Fatal("HEAD 缺少 Content-Length")
		}
	})

	t.Run("assets 缺失返回 404，其它路径回退首页", func(t *testing.T) {
		if got := request("/assets/missing.js", "", http.MethodGet).Code; got != http.StatusNotFound {
			t.Fatalf("/assets/ 缺失应 404，实际 %d", got)
		}
		w := request("/some/deep/route", "", http.MethodGet)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "<title>app</title>") {
			t.Fatalf("未知路径未回退到 index.html：code=%d body=%q", w.Code, w.Body.String())
		}
	})
}
