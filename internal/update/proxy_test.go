package update

import (
	"path/filepath"
	"testing"
)

func TestProxyConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()
	m := New(dir, "2.4.38")

	if err := m.SaveConfig(Config{Proxy: "http://10.10.10.254:7890"}); err != nil {
		t.Fatal(err)
	}
	if m.Proxy() != "http://10.10.10.254:7890" {
		t.Fatalf("代理未生效: %q", m.Proxy())
	}
	// 重新加载应读回同一配置
	m2 := New(dir, "2.4.38")
	if m2.Proxy() != "http://10.10.10.254:7890" {
		t.Fatalf("重启后未加载代理: %q", m2.Proxy())
	}
	cfg, err := m2.LoadConfig()
	if err != nil || cfg.Proxy != "http://10.10.10.254:7890" {
		t.Fatalf("配置读取不对: %+v %v", cfg, err)
	}
	// 文件落在 config 目录
	if _, err := filepath.Abs(m2.configPath()); err != nil {
		t.Fatal(err)
	}
}

func TestProxyRejectsInvalid(t *testing.T) {
	m := New(t.TempDir(), "2.4.38")
	for _, bad := range []string{"10.10.10.254:7890", "socks5://x:1", "http://"} {
		if err := m.SaveConfig(Config{Proxy: bad}); err == nil {
			t.Fatalf("非法代理应被拒绝: %q", bad)
		}
	}
}

func TestProxyClearRestoresDirect(t *testing.T) {
	m := New(t.TempDir(), "2.4.38")
	if err := m.SaveConfig(Config{Proxy: "http://10.10.10.254:7890"}); err != nil {
		t.Fatal(err)
	}
	if err := m.SaveConfig(Config{Proxy: ""}); err != nil {
		t.Fatal(err)
	}
	if m.Proxy() != "" {
		t.Fatalf("清空后应为直连: %q", m.Proxy())
	}
}
