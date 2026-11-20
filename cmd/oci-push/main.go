// oci-push 把一个裸二进制推成 OCI artifact，供容器内自更新拉取。
//
// 用法：
//
//	oci-push -file giftbook-linux-amd64 -tag update-v2.4.33-amd64 \
//	         -repo 1316195118/gift-book -token <GHCR_TOKEN>
//
// 只依赖标准库：上传 blob（monolithic POST）→ 上传 config → 上传 manifest。
// 仓库需为公开，或用有 write:packages 权限的 token。
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

var registry = "https://ghcr.io"

func main() {
	file := flag.String("file", "", "要推送的二进制文件")
	tag := flag.String("tag", "", "OCI 标签，如 update-v2.4.33-amd64")
	repo := flag.String("repo", "1316195118/gift-book", "目标仓库")
	token := flag.String("token", "", "GHCR token，缺省从 GITHUB_TOKEN 读")
	flag.Parse()

	tok := *token
	if tok == "" {
		tok = os.Getenv("GITHUB_TOKEN")
	}
	if *file == "" || *tag == "" || tok == "" {
		fmt.Fprintln(os.Stderr, "需要 -file、-tag 和 token")
		os.Exit(1)
	}

	data, err := os.ReadFile(*file)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	if err := push(client, *repo, *tag, tok, data); err != nil {
		fmt.Fprintln(os.Stderr, "推送失败:", err)
		os.Exit(1)
	}
	fmt.Printf("已推送 %s (%d bytes)\n", *tag, len(data))
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func put(client *http.Client, repo, path, contentType string, body []byte, tok string) error {
	u := registry + "/v2/" + repo + path
	req, err := http.NewRequest(http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", contentType)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("PUT %s 返回 %d: %s", path, resp.StatusCode, msg)
	}
	return nil
}

func push(client *http.Client, repo, tag, tok string, binary []byte) error {
	binDigest := digest(binary)

	// 1. 上传二进制 blob（monolithic：一次 PUT 带 digest 参数）
	q := url.Values{}
	q.Set("digest", binDigest)
	blobPath := "/blobs/uploads/?" + q.Encode()
	if err := put(client, repo, blobPath, "application/octet-stream", binary, tok); err != nil {
		return fmt.Errorf("上传二进制: %w", err)
	}

	// 2. 空 config blob（OCI artifact 惯例）
	cfg := []byte("{}")
	cfgDigest := digest(cfg)
	q = url.Values{}
	q.Set("digest", cfgDigest)
	if err := put(client, repo, "/blobs/uploads/?"+q.Encode(), "application/vnd.oci.empty.v1+json", cfg, tok); err != nil {
		return fmt.Errorf("上传 config: %w", err)
	}

	// 3. manifest
	m := map[string]any{
		"schemaVersion": 2,
		"mediaType":     "application/vnd.oci.image.manifest.v1+json",
		"config": map[string]any{
			"mediaType": "application/vnd.oci.empty.v1+json",
			"digest":    cfgDigest,
			"size":      len(cfg),
		},
		"layers": []map[string]any{{
			"mediaType": "application/octet-stream",
			"digest":    binDigest,
			"size":      len(binary),
			"annotations": map[string]string{
				"org.opencontainers.image.title": strings.TrimPrefix(tag, "update-"),
			},
		}},
	}
	manifest, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return put(client, repo, "/manifests/"+url.PathEscape(tag),
		"application/vnd.oci.image.manifest.v1+json", manifest, tok)
}
