package oci

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeRegistry 模拟 OCI registry 的 token / tags / manifest / blob 四个端点。
func fakeRegistry(t *testing.T, tags []string, blob []byte) *httptest.Server {
	t.Helper()
	sum := sha256.Sum256(blob)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/token"):
			json.NewEncoder(w).Encode(map[string]string{"token": "test-token"})
		case strings.HasSuffix(r.URL.Path, "/tags/list"):
			json.NewEncoder(w).Encode(map[string]any{"tags": tags})
		case strings.Contains(r.URL.Path, "/manifests/"):
			json.NewEncoder(w).Encode(manifest{
				SchemaVersion: 2,
				Layers:        []descriptor{{MediaType: "application/octet-stream", Digest: digest, Size: int64(len(blob))}},
			})
		case strings.Contains(r.URL.Path, "/blobs/"):
			w.Write(blob)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestDownloadLayerVerifiesDigest(t *testing.T) {
	blob := []byte("fake-giftbook-binary")
	srv := fakeRegistry(t, nil, blob)
	defer srv.Close()
	c := New("test/repo")
	c.setRegistryForTest(srv.URL)

	digest, _, err := c.LayerDigest("update-v9.9.9-amd64")
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.DownloadLayer(digest, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(blob) {
		t.Fatalf("内容不符: %q", got)
	}
}

func TestDownloadLayerRejectsCorruptBlob(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/token") {
			json.NewEncoder(w).Encode(map[string]string{"token": "t"})
			return
		}
		if strings.Contains(r.URL.Path, "/blobs/") {
			w.Write([]byte("被改过的内容"))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()
	c := New("test/repo")
	c.setRegistryForTest(srv.URL)
	// digest 指向另一个内容，下载时应校验失败
	fake := "sha256:" + strings.Repeat("0", 64)
	if _, err := c.DownloadLayer(fake, 1<<20); err == nil {
		t.Fatal("篡改的 blob 应被拒绝")
	}
}

func TestTags(t *testing.T) {
	srv := fakeRegistry(t, []string{"update-v2.4.33-amd64", "latest", "ocr-v2.4.32"}, nil)
	defer srv.Close()
	c := New("test/repo")
	c.setRegistryForTest(srv.URL)
	tags, err := c.Tags()
	if err != nil {
		t.Fatal(err)
	}
	if len(tags) != 3 {
		t.Fatalf("标签数量不对: %v", tags)
	}
}
