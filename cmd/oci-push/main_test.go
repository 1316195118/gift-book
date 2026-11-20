package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPushUploadsBlobConfigManifest(t *testing.T) {
	var paths []string
	var manifest map[string]any
	old := registry
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(r.URL.Path, "/manifests/") {
			json.Unmarshal(body, &manifest)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	registry = srv.URL
	defer func() { registry = old }()

	binary := []byte("fake-linux-binary")
	if err := push(&http.Client{Timeout: time.Second}, "test/repo", "update-v9.9.9-amd64", "tok", binary); err != nil {
		t.Fatal(err)
	}
	if len(paths) != 3 {
		t.Fatalf("应有三次上传(blob/config/manifest)，实际 %v", paths)
	}
	if !strings.Contains(paths[2], "/manifests/update-v9.9.9-amd64") {
		t.Fatalf("manifest 路径不对: %s", paths[2])
	}
	layers := manifest["layers"].([]any)
	layer := layers[0].(map[string]any)
	if layer["size"].(float64) != float64(len(binary)) {
		t.Fatalf("layer size 不对: %v", layer["size"])
	}
	if !strings.HasPrefix(layer["digest"].(string), "sha256:") {
		t.Fatalf("layer digest 不对: %v", layer["digest"])
	}
}

func TestDigest(t *testing.T) {
	got := digest([]byte("abc"))
	want := "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got != want {
		t.Fatalf("digest 错误: %s", got)
	}
}
