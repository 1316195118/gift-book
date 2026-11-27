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
	flag.Parse()

	// token 只从环境变量读，避免出现在本机 ps / CI 日志的命令行里。
	tok := strings.TrimSpace(os.Getenv("GITHUB_TOKEN"))
	if tok == "" {
		tok = strings.TrimSpace(os.Getenv("GHCR_TOKEN"))
	}
	if *file == "" || *tag == "" || tok == "" {
		fmt.Fprintln(os.Stderr, "需要 -file、-tag，并设置 GITHUB_TOKEN 或 GHCR_TOKEN 环境变量")
		os.Exit(1)
	}

	data, err := os.ReadFile(*file)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	bearer, err := exchangeToken(client, *repo, tok)
	if err != nil {
		fmt.Fprintln(os.Stderr, "换取写入 token 失败:", err)
		os.Exit(1)
	}
	if err := push(client, *repo, *tag, bearer, data); err != nil {
		fmt.Fprintln(os.Stderr, "推送失败:", err)
		os.Exit(1)
	}
	fmt.Printf("已推送 %s (%d bytes)\n", *tag, len(data))
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// exchangeToken 把 GitHub PAT / GITHUB_TOKEN 换成 registry 的 Bearer token。
// 直接把 PAT 当 Bearer 用会被 GHCR 拒绝（403），必须先走 token 端点。
func exchangeToken(client *http.Client, repo, pat string) (string, error) {
	q := url.Values{}
	q.Set("scope", "repository:"+repo+":pull,push")
	q.Set("service", "ghcr.io")
	req, err := http.NewRequest(http.MethodGet, registry+"/token?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	owner := repo
	if i := strings.Index(repo, "/"); i > 0 {
		owner = repo[:i]
	}
	req.SetBasicAuth(owner, pat)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return "", fmt.Errorf("换 token 返回 %d: %s", resp.StatusCode, msg)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if out.Token == "" {
		return "", fmt.Errorf("换到的 token 为空")
	}
	return out.Token, nil
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

// uploadBlob 走 registry 标准的两步上传：先 POST 拿 upload 地址，
// 再把内容和 digest 一起 PUT 过去。GHCR 不接受单步 PUT（会返回 405）。
func uploadBlob(client *http.Client, repo, contentType string, data []byte, tok string) error {
	dg := digest(data)
	req, err := http.NewRequest(http.MethodPost, registry+"/v2/"+repo+"/blobs/uploads/", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("开始上传返回 %d", resp.StatusCode)
	}
	location := resp.Header.Get("Location")
	if location == "" {
		return fmt.Errorf("上传响应缺少 Location")
	}
	if strings.HasPrefix(location, "/") {
		location = registry + location
	} else if !strings.HasPrefix(location, "http") {
		location = registry + "/" + location
	}
	sep := "?"
	if strings.Contains(location, "?") {
		sep = "&"
	}
	uploadURL := location + sep + "digest=" + url.QueryEscape(dg)

	putReq, err := http.NewRequest(http.MethodPut, uploadURL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	putReq.Header.Set("Authorization", "Bearer "+tok)
	// GHCR 只接受 octet-stream 作为 blob 上传的 Content-Type；
	// media type 由 manifest 描述，不在这里声明。
	_ = contentType
	putReq.Header.Set("Content-Type", "application/octet-stream")
	putResp, err := client.Do(putReq)
	if err != nil {
		return err
	}
	defer putResp.Body.Close()
	if putResp.StatusCode < 200 || putResp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(putResp.Body, 512))
		return fmt.Errorf("上传 blob 返回 %d: %s", putResp.StatusCode, msg)
	}
	return nil
}

func push(client *http.Client, repo, tag, tok string, binary []byte) error {
	// 1. 上传二进制 blob
	if err := uploadBlob(client, repo, "application/octet-stream", binary, tok); err != nil {
		return fmt.Errorf("上传二进制: %w", err)
	}

	// 2. 空 config blob（OCI artifact 惯例）
	cfg := []byte("{}")
	cfgDigest := digest(cfg)
	if err := uploadBlob(client, repo, "application/vnd.oci.image.config.v1+json", cfg, tok); err != nil {
		return fmt.Errorf("上传 config: %w", err)
	}

	// 3. manifest
	m := map[string]any{
		"schemaVersion": 2,
		"mediaType":     "application/vnd.oci.image.manifest.v1+json",
		"config": map[string]any{
			"mediaType": "application/vnd.oci.image.config.v1+json",
			"digest":    cfgDigest,
			"size":      len(cfg),
		},
		"layers": []map[string]any{{
			"mediaType": "application/octet-stream",
			"digest":    digest(binary),
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
