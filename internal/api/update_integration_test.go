package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"giftbook/internal/oci"
	"giftbook/internal/update"
)

func waitUpdateJob(t *testing.T, env *testEnv, wantState string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		res, payload := env.do(t, "GET", "/api/update/progress", nil, nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("progress 失败: %d %v", res.StatusCode, payload)
		}
		job, _ := payload["data"].(map[string]any)
		if job["state"] == wantState {
			return job
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("等待更新任务进入 %s 超时", wantState)
	return nil
}

// 端到端：假 registry 提供更新包 → 检查发现新版 → 下载替换 → 触发重启信号。
func TestUpdateFullChain(t *testing.T) {
	// 造一个"新版本二进制"内容
	newBinary := []byte("#!/bin/sh\necho v2.4.33\n")
	sum := sha256.Sum256(newBinary)
	blobDigest := "sha256:" + hex.EncodeToString(sum[:])

	reg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/token"):
			json.NewEncoder(w).Encode(map[string]string{"token": "t"})
		case strings.HasSuffix(r.URL.Path, "/tags/list"):
			json.NewEncoder(w).Encode(map[string]any{"tags": []string{"update-v2.4.33-amd64"}})
		case strings.Contains(r.URL.Path, "/manifests/"):
			json.NewEncoder(w).Encode(map[string]any{
				"schemaVersion": 2,
				"layers":        []map[string]any{{"digest": blobDigest, "size": len(newBinary)}},
			})
		case strings.Contains(r.URL.Path, "/blobs/"):
			w.Write(newBinary)
		default:
			http.NotFound(w, r)
		}
	}))
	defer reg.Close()

	dir := t.TempDir()
	env := newEnv(t)
	env.api.autoRestart = true
	mgr := update.New(dir, "2.4.32")
	mgr.SetClientForTest(oci.NewFromRegistryForTest(reg.URL, "1316195118/gift-book"))
	env.api.updater = mgr

	// 1. 检查更新
	res, payload := env.do(t, "GET", "/api/update/check", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("check 失败: %d %v", res.StatusCode, payload)
	}
	data := payload["data"].(map[string]any)
	if data["available"] != true || data["version"] != "v2.4.33" {
		t.Fatalf("check 结果不对: %v", data)
	}

	// 2. 安装更新
	res, payload = env.do(t, "POST", "/api/update/apply", map[string]any{"tag": "update-v2.4.33-amd64"}, nil)
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("apply 失败: %d %v", res.StatusCode, payload)
	}
	job := waitUpdateJob(t, env, "succeeded")
	if job["percent"] != float64(100) || job["restart"] != true {
		t.Fatalf("更新完成状态不对: %v", job)
	}

	// 3. 二进制落盘且内容正确
	target := filepath.Join(dir, "giftbook")
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(newBinary) {
		t.Fatalf("落盘内容不符: %q", got)
	}

	// 4. 重启信号已触发（延迟 600ms）
	select {
	case <-env.api.RestartChannel():
		// ok
	case <-time.After(2 * time.Second):
		t.Fatal("更新后应触发重启信号")
	}
}

// 伪造标签必须被拒，不能下载任意 tag。
func TestUpdateApplyRejectsStaleTag(t *testing.T) {
	reg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/token"):
			json.NewEncoder(w).Encode(map[string]string{"token": "t"})
		case strings.HasSuffix(r.URL.Path, "/tags/list"):
			json.NewEncoder(w).Encode(map[string]any{"tags": []string{"update-v2.4.33-amd64"}})
		case strings.Contains(r.URL.Path, "/manifests/"):
			json.NewEncoder(w).Encode(map[string]any{"schemaVersion": 2, "layers": []map[string]any{{"digest": "sha256:" + strings.Repeat("0", 64), "size": 8}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer reg.Close()

	env := newEnv(t)
	mgr := update.New(t.TempDir(), "2.4.32")
	mgr.SetClientForTest(oci.NewFromRegistryForTest(reg.URL, "1316195118/gift-book"))
	env.api.updater = mgr

	res, payload := env.do(t, "POST", "/api/update/apply", map[string]any{"tag": "update-v9.9.9-amd64"}, nil)
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("安装任务应被接受: %d %v", res.StatusCode, payload)
	}
	job := waitUpdateJob(t, env, "failed")
	if !strings.Contains(job["error"].(string), "不一致") {
		t.Fatalf("伪造标签应在后台被拒: %v", job)
	}
}
