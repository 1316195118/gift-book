// 极简 OCI registry 客户端：只实现自更新需要的四件事——取匿名 token、
// 列标签、取 manifest、按 digest 下载 blob。纯标准库，不引入新依赖。
//
// 更新包是裸二进制作为 OCI layer 推送的制品，标签形如 update-v2.4.33-amd64。
// 下载时按 manifest 里的 digest 复算 sha256，损坏或被篡改的包会被拒绝。
package oci

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultRegistry = "https://ghcr.io"

// Client 是一个只读的 OCI registry 客户端。
type Client struct {
	registry string
	repo     string
	http     *http.Client
}

func New(repo string) *Client {
	return &Client{
		registry: defaultRegistry,
		repo:     repo,
		http:     &http.Client{Timeout: 5 * time.Minute},
	}
}

func (c *Client) setRegistryForTest(reg string) { c.registry = strings.TrimRight(reg, "/") }

// NewFromRegistryForTest 供上层模块注入本地 registry 做集成测试。
func NewFromRegistryForTest(reg, repo string) *Client {
	c := New(repo)
	c.setRegistryForTest(reg)
	return c
}

type tokenResponse struct {
	Token string `json:"token"`
}

// token 取匿名 pull token；公开包不需要凭据。
func (c *Client) token() (string, error) {
	q := url.Values{}
	q.Set("scope", "repository:"+c.repo+":pull")
	q.Set("service", strings.TrimPrefix(strings.TrimPrefix(c.registry, "https://"), "http://"))
	resp, err := c.http.Get(c.registry + "/token?" + q.Encode())
	if err != nil {
		return "", fmt.Errorf("取 token 失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("取 token 返回 %d", resp.StatusCode)
	}
	var tr tokenResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tr); err != nil {
		return "", fmt.Errorf("解析 token 失败: %w", err)
	}
	if tr.Token == "" {
		return "", fmt.Errorf("token 为空")
	}
	return tr.Token, nil
}

func (c *Client) get(path string) (*http.Response, error) {
	tok, err := c.token()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, c.registry+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Accept", "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/octet-stream")
	return c.http.Do(req)
}

// Tags 列出仓库里的全部标签。
// registry 会分页（GHCR 每页 100 个），必须顺着 Link 头取完，
// 否则更新包标签排在后面时会被漏掉，导致永远检测不到新版本。
func (c *Client) Tags() ([]string, error) {
	var all []string
	path := "/v2/" + c.repo + "/tags/list"
	for page := 0; page < 20; page += 1 {
		resp, err := c.get(path)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("列标签返回 %d", resp.StatusCode)
		}
		var result struct {
			Tags []string `json:"tags"`
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&result)
		next := nextLink(resp.Header.Get("Link"))
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("解析标签失败: %w", err)
		}
		all = append(all, result.Tags...)
		if next == "" {
			return all, nil
		}
		path = next
	}
	return all, nil
}

// nextLink 从 Link 头里取 rel="next" 的地址，没有则返回空。
func nextLink(header string) string {
	if header == "" {
		return ""
	}
	for _, part := range strings.Split(header, ",") {
		if !strings.Contains(part, `rel="next"`) {
			continue
		}
		start := strings.Index(part, "<")
		end := strings.Index(part, ">")
		if start >= 0 && end > start {
			return part[start+1 : end]
		}
	}
	return ""
}

type descriptor struct {
	MediaType string `json:"mediaType"`
	Digest    string `json:"digest"`
	Size      int64  `json:"size"`
}

type manifest struct {
	SchemaVersion int          `json:"schemaVersion"`
	MediaType     string       `json:"mediaType"`
	Layers        []descriptor `json:"layers"`
}

// LayerDigest 返回 manifest 里第一个 layer 的 digest 和大小——更新包只有一层，
// 就是裸二进制。
func (c *Client) LayerDigest(tag string) (digest string, size int64, err error) {
	resp, err := c.get("/v2/" + c.repo + "/manifests/" + url.PathEscape(tag))
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("取 manifest 返回 %d", resp.StatusCode)
	}
	var m manifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&m); err != nil {
		return "", 0, fmt.Errorf("解析 manifest 失败: %w", err)
	}
	if len(m.Layers) == 0 {
		return "", 0, fmt.Errorf("manifest 没有 layer")
	}
	return m.Layers[0].Digest, m.Layers[0].Size, nil
}

// DownloadLayer 按 digest 下载 layer，复算 sha256 与 digest 一致才返回内容。
// 网络不稳时（实测某些 NAS 到 GHCR 存储会中途断开）重试三次，
// 每次失败都重新校验，截断或损坏的响应不会被接受。
func (c *Client) DownloadLayer(digest string, maxBytes int64) ([]byte, error) {
	if !strings.HasPrefix(digest, "sha256:") {
		return nil, fmt.Errorf("不支持的 digest 格式")
	}
	want := strings.TrimPrefix(digest, "sha256:")
	if !isHex(want) {
		return nil, fmt.Errorf("digest 不是合法的 hex")
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
		}
		data, err := c.downloadOnce(digest, want, maxBytes)
		if err == nil {
			return data, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func (c *Client) downloadOnce(digest, want string, maxBytes int64) ([]byte, error) {
	resp, err := c.get("/v2/" + c.repo + "/blobs/" + url.PathEscape(digest))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载 blob 返回 %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("下载中断: %w", err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("blob 超过大小上限")
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != want {
		return nil, fmt.Errorf("blob 校验失败（可能下载不完整）: 得到 %d 字节", len(data))
	}
	return data, nil
}

func isHex(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}
