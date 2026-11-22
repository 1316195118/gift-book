package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteJSONCompressesLargeResponseWhenAccepted(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(jsonCompressionWriter{ResponseWriter: rec}, 200, response{
		Success: true,
		Data:    map[string]string{"payload": strings.Repeat("电子礼簿", 512)},
	})

	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Accept-Encoding") {
		t.Fatalf("Vary = %q, want Accept-Encoding", got)
	}
	zr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	defer zr.Close()
	raw, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("read gzip body: %v", err)
	}
	var payload response
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Success {
		t.Fatal("compressed response lost success flag")
	}
}

func TestWriteJSONKeepsSmallResponsePlain(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(jsonCompressionWriter{ResponseWriter: rec}, 200, response{Success: true})

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("small response Content-Encoding = %q, want empty", got)
	}
	var payload response
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Success {
		t.Fatal("plain response lost success flag")
	}
}

func TestSecurityHeadersEnableJSONCompressionOnlyWhenAccepted(t *testing.T) {
	server := &Server{}
	body := response{Success: true, Data: map[string]string{"payload": strings.Repeat("账簿", 1024)}}
	handler := server.securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, body)
	}))

	compressed := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/events", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	handler.ServeHTTP(compressed, req)
	if got := compressed.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("API Content-Encoding = %q, want gzip", got)
	}

	plain := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/events", nil)
	handler.ServeHTTP(plain, req)
	if got := plain.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("unaccepted API Content-Encoding = %q, want empty", got)
	}
}
