package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o775); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func mustExist(t *testing.T, parts ...string) {
	t.Helper()
	path := filepath.Join(parts...)
	if _, err := os.Stat(path); err != nil {
		t.Errorf("应有 %s: %v", path, err)
	}
}

func mustAbsent(t *testing.T, parts ...string) {
	t.Helper()
	path := filepath.Join(parts...)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("不该有 %s", path)
	}
}

func TestMigrateLegacyLayoutSplitsDataAndConfig(t *testing.T) {
	base := t.TempDir()
	legacy := filepath.Join(base, legacyDataDir)
	data := filepath.Join(base, "data")
	config := filepath.Join(base, "config")
	writeTree(t, legacy, map[string]string{
		"events.json":                       `{"e1":{"id":"e1"}}`,
		"gifts_e1.json":                     `{}`,
		"auth-state.json":                   `{"enabled":true}`,
		"auth-throttle.json":                `{}`,
		"autobackup.json":                   `{"enabled":false}`,
		"auth.json":                         `{}`,
		"backups/auto-20260101-120000.zip":  "zip",
		".trash/20260101-120000/event.json": `{}`,
	})

	migrateLegacyLayout(base, data, config)

	for _, name := range []string{"events.json", "gifts_e1.json", ".trash/20260101-120000/event.json"} {
		mustExist(t, data, filepath.FromSlash(name))
	}
	for _, name := range []string{
		"auth-state.json", "auth-throttle.json", "autobackup.json", "auth.json",
		"backups/auto-20260101-120000.zip",
	} {
		mustExist(t, config, filepath.FromSlash(name))
	}
	for _, name := range []string{"auth-state.json", "auth-throttle.json", "autobackup.json", "backups"} {
		mustAbsent(t, data, name)
	}
	// 源目录必须原封不动保留，内容也要逐字节一致。
	mustExist(t, legacy, "events.json")
	raw, err := os.ReadFile(filepath.Join(data, "events.json"))
	if err != nil || string(raw) != `{"e1":{"id":"e1"}}` {
		t.Fatalf("账簿数据不一致: %q err=%v", raw, err)
	}
}

func TestMigrateSkipsWhenDataAlreadyExists(t *testing.T) {
	base := t.TempDir()
	legacy := filepath.Join(base, legacyDataDir)
	data := filepath.Join(base, "data")
	config := filepath.Join(base, "config")
	writeTree(t, legacy, map[string]string{
		"events.json":     `{"old":{}}`,
		"auth-state.json": `{"enabled":true}`,
	})
	writeTree(t, data, map[string]string{"events.json": `{"new":{}}`})

	migrateLegacyLayout(base, data, config)

	raw, _ := os.ReadFile(filepath.Join(data, "events.json"))
	if string(raw) != `{"new":{}}` {
		t.Fatalf("已有账簿被覆盖: %s", raw)
	}
	mustAbsent(t, config, "auth-state.json")
}

func TestMigrateIsIdempotentAndKeepsNewerConfig(t *testing.T) {
	base := t.TempDir()
	legacy := filepath.Join(base, legacyDataDir)
	data := filepath.Join(base, "data")
	config := filepath.Join(base, "config")
	writeTree(t, legacy, map[string]string{
		"events.json":     `{}`,
		"gifts_e1.json":   `{}`,
		"auth-state.json": `{"enabled":false}`,
	})

	migrateLegacyLayout(base, data, config)
	if err := os.WriteFile(filepath.Join(config, "auth-state.json"), []byte(`{"enabled":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	// 第二次跑：data/events.json 已存在，应整体跳过，不覆盖手工改过的配置。
	migrateLegacyLayout(base, data, config)

	raw, _ := os.ReadFile(filepath.Join(config, "auth-state.json"))
	if string(raw) != `{"enabled":true}` {
		t.Fatalf("已有配置被覆盖: %s", raw)
	}
	count := 0
	_ = filepath.WalkDir(data, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			count++
		}
		return nil
	})
	if count != 2 {
		t.Fatalf("data/ 文件数异常（应只有 events.json 与 gifts_e1.json）: %d", count)
	}
}

func TestMigrateNoopWithoutLegacyDir(t *testing.T) {
	base := t.TempDir()
	data := filepath.Join(base, "data")
	config := filepath.Join(base, "config")
	migrateLegacyLayout(base, data, config)
	mustAbsent(t, data)
	mustAbsent(t, config)
}
