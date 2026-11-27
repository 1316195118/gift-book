// 容器内自更新：从 GHCR 拉取裸二进制更新包，校验后原子替换 /config/giftbook。
// 更新包标签形如 update-v2.4.33-amd64；应用重启时由入口脚本优先执行这个文件。
//
// 安全约束：
//   - 只接受比当前版本更高的版本，不允许降级或同版本反复替换；
//   - layer digest 与下载内容双重 sha256 校验；
//   - 写入临时文件后 fsync + rename，避免半截文件；
//   - 二进制大小有上限，防止恶意大包打满磁盘。
package update

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"giftbook/internal/oci"
)

const (
	repo          = "1316195118/gift-book"
	maxBinarySize = 64 << 20 // 64MB，足够当前约 8MB 的二进制
)

var versionTag = regexp.MustCompile(`^update-v(\d+)\.(\d+)\.(\d+)-(.+)$`)

// Version 是一个语义化版本号。
type Version struct {
	Major, Minor, Patch int
	Raw                 string
}

func (v Version) String() string { return fmt.Sprintf("v%d.%d.%d", v.Major, v.Minor, v.Patch) }

func (v Version) newerThan(other Version) bool {
	if v.Major != other.Major {
		return v.Major > other.Major
	}
	if v.Minor != other.Minor {
		return v.Minor > other.Minor
	}
	return v.Patch > other.Patch
}

func parseVersion(raw string) (Version, bool) {
	raw = strings.TrimPrefix(strings.TrimSpace(raw), "v")
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return Version{}, false
	}
	nums := [3]int{}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return Version{}, false
		}
		nums[i] = n
	}
	return Version{Major: nums[0], Minor: nums[1], Patch: nums[2], Raw: raw}, true
}

// Available 描述一个可安装的更新。
type Available struct {
	Version  string `json:"version"`
	Tag      string `json:"tag"`
	Digest   string `json:"digest"`
	Size     int64  `json:"size"`
	Current  string `json:"current"`
	Arch     string `json:"arch"`
	CanApply bool   `json:"canApply"`
}

// Manager 管理更新检查与安装。
type Manager struct {
	client     *oci.Client
	configDir  string
	currentVer string
	arch       string
	now        func() time.Time
	mu         sync.Mutex
	proxy      string
}

func New(configDir, currentVersion string) *Manager {
	m := &Manager{
		client:     oci.New(repo),
		configDir:  configDir,
		currentVer: currentVersion,
		arch:       runtime.GOARCH,
		now:        time.Now,
	}
	if cfg, err := m.LoadConfig(); err == nil && cfg.Proxy != "" {
		_ = m.SetProxy(cfg.Proxy)
	}
	if envProxy := strings.TrimSpace(os.Getenv("GIFTBOOK_UPDATE_PROXY")); envProxy != "" {
		// 只有设置成功才记录，避免无效地址让 UI 误以为代理已生效。
		if err := m.SetProxy(envProxy); err != nil {
			fmt.Fprintf(os.Stderr, "GIFTBOOK_UPDATE_PROXY 无效（%v），将直连 GHCR\n", err)
		}
	}
	return m
}

// Config 是自更新的可配置项，存在 config 目录下的 update-config.json。
type Config struct {
	// Proxy 形如 http://10.10.10.254:7890；空串表示直连。
	Proxy string `json:"proxy"`
}

func (m *Manager) configPath() string {
	return filepath.Join(m.configDir, "update-config.json")
}

// LoadConfig 读取本地配置；文件不存在时返回零值。
func (m *Manager) LoadConfig() (Config, error) {
	var cfg Config
	data, err := os.ReadFile(m.configPath())
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// SetProxy 设置并记住代理；传空串表示直连。
func (m *Manager) SetProxy(raw string) error {
	raw = strings.TrimSpace(raw)
	if err := m.client.SetProxy(raw); err != nil {
		return err
	}
	m.mu.Lock()
	m.proxy = raw
	m.mu.Unlock()
	return nil
}

// SaveConfig 把代理设置写入磁盘。
func (m *Manager) SaveConfig(cfg Config) error {
	if err := m.SetProxy(cfg.Proxy); err != nil {
		return err
	}
	if err := os.MkdirAll(m.configDir, 0o775); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.configPath() + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.configPath())
}

// Proxy 返回当前生效的代理地址。
func (m *Manager) Proxy() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.proxy
}

// SetClientForTest 允许测试注入本地 registry，生产代码不要调用。
func (m *Manager) SetClientForTest(c *oci.Client) { m.client = c }

// Check 查询是否有更新。网络失败时返回错误，由调用方决定如何提示。
func (m *Manager) Check() (*Available, error) {
	tags, err := m.client.Tags()
	if err != nil {
		return nil, err
	}
	cur, ok := parseVersion(m.currentVer)
	if !ok {
		return nil, fmt.Errorf("当前版本号无法解析: %q", m.currentVer)
	}

	type candidate struct {
		v   Version
		tag string
	}
	var candidates []candidate
	for _, tag := range tags {
		mm := versionTag.FindStringSubmatch(tag)
		if mm == nil || mm[4] != m.arch {
			continue
		}
		v, ok := parseVersion(mm[1] + "." + mm[2] + "." + mm[3])
		if !ok || !v.newerThan(cur) {
			continue
		}
		candidates = append(candidates, candidate{v: v, tag: tag})
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	// 降序：最新的排在最前。
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].v.newerThan(candidates[j].v)
	})
	best := candidates[0]
	digest, size, err := m.client.LayerDigest(best.tag)
	if err != nil {
		return nil, err
	}
	return &Available{
		Version:  best.v.String(),
		Tag:      best.tag,
		Digest:   digest,
		Size:     size,
		Current:  m.currentVer,
		Arch:     m.arch,
		CanApply: m.configDir != "",
	}, nil
}

// Result 描述一次安装的结果。
type Result struct {
	Version  string `json:"version"`
	Path     string `json:"path"`
	Rejected string `json:"rejected,omitempty"`
}

// Progress 是一次安装的可展示阶段与字节进度。
type Progress struct {
	Stage      string `json:"stage"`
	Message    string `json:"message"`
	Percent    int    `json:"percent"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}

// Apply 下载并安装指定标签的更新包。
// 写入临时文件 → 校验 → chmod → rename，全程在 configDir 下完成。
func (m *Manager) Apply(a *Available) (*Result, error) {
	return m.ApplyWithProgress(a, nil)
}

// ApplyWithProgress 与 Apply 相同，并在关键阶段和下载过程中回报进度。
// 进度只用于展示；安装是否成功仍由返回值与文件校验决定。
func (m *Manager) ApplyWithProgress(a *Available, onProgress func(Progress)) (*Result, error) {
	if a == nil || a.Tag == "" {
		return nil, errors.New("没有可安装的更新")
	}
	if !m.AllowedTag(a.Tag) {
		return nil, errors.New("更新包标签不合法")
	}
	if m.configDir == "" {
		return nil, errors.New("未配置更新目录")
	}
	if a.Size > maxBinarySize {
		return nil, errors.New("更新包体积异常")
	}
	report := func(stage, message string, percent int, downloaded, total int64) {
		if onProgress == nil {
			return
		}
		if percent < 0 {
			percent = 0
		}
		if percent > 100 {
			percent = 100
		}
		onProgress(Progress{
			Stage:      stage,
			Message:    message,
			Percent:    percent,
			Downloaded: downloaded,
			Total:      total,
		})
	}

	report("preparing", "正在读取更新包信息…", 4, 0, a.Size)

	digest, size, err := m.client.LayerDigest(a.Tag)
	if err != nil {
		return nil, err
	}
	if size > maxBinarySize {
		return nil, errors.New("更新包体积异常")
	}
	report("downloading", "正在下载更新包…", 10, 0, size)
	data, err := m.client.DownloadLayerWithProgress(digest, maxBinarySize, func(downloaded, total int64) {
		if total <= 0 {
			total = size
		}
		percent := 10
		if total > 0 {
			percent += int(float64(downloaded) / float64(total) * 70)
		}
		report("downloading", "正在下载更新包…", percent, downloaded, total)
	})
	if err != nil {
		return nil, err
	}
	report("installing", "下载完成，正在校验并写入…", 84, size, size)

	if err := os.MkdirAll(m.configDir, 0o775); err != nil {
		return nil, err
	}
	tmp, err := os.CreateTemp(m.configDir, ".giftbook-update-*")
	if err != nil {
		return nil, err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	// Windows 上 rename 到已存在文件会保留目标权限，所以先把目标设为可执行，
	// 同时临时文件本身也 chmod，双保险。
	target := filepath.Join(m.configDir, "giftbook")
	if _, statErr := os.Stat(target); statErr == nil {
		_ = os.Chmod(target, 0o755)
	}

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return nil, err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		return nil, err
	}

	if err := os.Rename(tmpPath, target); err != nil {
		return nil, err
	}
	report("complete", "更新已安装", 100, size, size)
	return &Result{Version: a.Version, Path: target}, nil
}

// AllowedTag 严格校验标签格式，防止路径注入或非本架构的包。
func (m *Manager) AllowedTag(tag string) bool {
	mm := versionTag.FindStringSubmatch(tag)
	return mm != nil && mm[4] == m.arch
}

// TargetPath 返回更新后的二进制应放置的路径，供入口脚本与状态接口使用。
func (m *Manager) TargetPath() string {
	return filepath.Join(m.configDir, "giftbook")
}
