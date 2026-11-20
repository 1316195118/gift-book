package update

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"giftbook/internal/oci"
)

func registryForTest(t *testing.T, tags []string, blob []byte) *httptest.Server {
	t.Helper()
	sum := sha256.Sum256(blob)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/token"):
			json.NewEncoder(w).Encode(map[string]string{"token": "t"})
		case strings.HasSuffix(r.URL.Path, "/tags/list"):
			json.NewEncoder(w).Encode(map[string]any{"tags": tags})
		case strings.Contains(r.URL.Path, "/manifests/"):
			json.NewEncoder(w).Encode(map[string]any{
				"schemaVersion": 2,
				"layers":        []map[string]any{{"mediaType": "application/octet-stream", "digest": digest, "size": len(blob)}},
			})
		case strings.Contains(r.URL.Path, "/blobs/"):
			w.Write(blob)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestCheckPicksHighestNewerVersion(t *testing.T) {
	tags := []string{
		"update-v2.4.32-amd64", // 当前版本，不算
		"update-v2.4.33-amd64",
		"update-v2.5.1-amd64",  // 最高
		"update-v2.4.40-arm64", // 别的架构
		"latest",
	}
	srv := registryForTest(t, tags, []byte("binary"))
	defer srv.Close()
	m := New(t.TempDir(), "2.4.32")
	m.SetClientForTest(oci.NewFromRegistryForTest(srv.URL, "1316195118/gift-book"))

	avail, err := m.Check()
	if err != nil {
		t.Fatal(err)
	}
	if avail == nil || avail.Version != "v2.5.1" {
		t.Fatalf("应选最高新版本，实际 %+v", avail)
	}
}

func TestCheckNoUpdate(t *testing.T) {
	srv := registryForTest(t, []string{"update-v2.4.32-amd64"}, []byte("binary"))
	defer srv.Close()
	m := New(t.TempDir(), "2.4.32")
	m.SetClientForTest(oci.NewFromRegistryForTest(srv.URL, "1316195118/gift-book"))
	avail, err := m.Check()
	if err != nil {
		t.Fatal(err)
	}
	if avail != nil {
		t.Fatalf("不应有更新: %+v", avail)
	}
}

func TestApplyWritesExecutableBinary(t *testing.T) {
	blob := []byte("#!/bin/sh\necho new binary\n")
	tags := []string{"update-v2.4.33-amd64"}
	srv := registryForTest(t, tags, blob)
	defer srv.Close()
	dir := t.TempDir()
	m := New(dir, "2.4.32")
	m.SetClientForTest(oci.NewFromRegistryForTest(srv.URL, "1316195118/gift-book"))

	avail, err := m.Check()
	if err != nil {
		t.Fatal(err)
	}
	result, err := m.Apply(avail)
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "giftbook")
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	// Windows 下 Go 不映射 Unix 执行位，只在非 Windows 上校验。
	if runtime.GOOS != "windows" && info.Mode()&0o111 == 0 {
		t.Fatalf("更新后的二进制应可执行: %v", info.Mode())
	}
	data, _ := os.ReadFile(target)
	if string(data) != string(blob) {
		t.Fatalf("内容不符")
	}
	if result.Version != "v2.4.33" {
		t.Fatalf("版本号不对: %s", result.Version)
	}
}

func TestApplyReportsDownloadProgress(t *testing.T) {
	blob := []byte(strings.Repeat("x", 600<<10))
	srv := registryForTest(t, []string{"update-v2.4.33-amd64"}, blob)
	defer srv.Close()
	m := New(t.TempDir(), "2.4.32")
	m.SetClientForTest(oci.NewFromRegistryForTest(srv.URL, "1316195118/gift-book"))
	avail, err := m.Check()
	if err != nil {
		t.Fatal(err)
	}
	var got []Progress
	if _, err := m.ApplyWithProgress(avail, func(progress Progress) {
		got = append(got, progress)
	}); err != nil {
		t.Fatal(err)
	}
	if len(got) < 3 {
		t.Fatalf("进度回调太少: %+v", got)
	}
	downloaded := false
	for _, progress := range got {
		if progress.Stage == "downloading" && progress.Downloaded == int64(len(blob)) && progress.Percent > 10 {
			downloaded = true
		}
	}
	if !downloaded {
		t.Fatalf("缺少完整下载进度: %+v", got)
	}
	last := got[len(got)-1]
	if last.Stage != "complete" || last.Percent != 100 || last.Total != int64(len(blob)) {
		t.Fatalf("结束进度不对: %+v", last)
	}
}

func TestApplyRejectsWrongArchTag(t *testing.T) {
	m := New(t.TempDir(), "2.4.32")
	avail := &Available{Version: "v2.4.33", Tag: "update-v2.4.33-arm64"}
	if _, err := m.Apply(avail); err == nil {
		t.Fatal("跨架构的更新包应被拒绝")
	}
}

func TestVersionCompare(t *testing.T) {
	newer := Version{Major: 2, Minor: 4, Patch: 10}
	older := Version{Major: 2, Minor: 4, Patch: 9}
	if !newer.newerThan(older) {
		t.Fatal("2.4.10 应大于 2.4.9")
	}
}
