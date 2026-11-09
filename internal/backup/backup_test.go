package backup

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"giftbook/internal/store"
)

func newStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.WithEvents(func(events map[string]store.Record) (bool, error) {
		events["e1"] = store.Record{"id": "e1", "name": "测试账簿"}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.WithGifts("e1", func(gifts map[string]store.Record) (bool, error) {
		gifts["g1"] = store.Record{"id": "g1", "encryptedContent": "x"}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestBuildIncludesAllData(t *testing.T) {
	s := newStore(t)
	data, manifest, err := Build(s, "test-build", true, []byte(`{"enabled":true}`))
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if manifest.Events != 1 || manifest.Gifts != 1 || !manifest.HasAuth {
		t.Fatalf("manifest wrong: %+v", manifest)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	names := map[string]bool{}
	for _, f := range reader.File {
		names[f.Name] = true
	}
	for _, want := range []string{"manifest.json", "data/events.json", "data/gifts_e1.json", "config/auth-state.json"} {
		if !names[want] {
			t.Fatalf("missing %s in %v", want, names)
		}
	}
}

func TestBuildWithoutAuthState(t *testing.T) {
	s := newStore(t)
	data, _, err := Build(s, "b", false, nil)
	if err != nil {
		t.Fatal(err)
	}
	reader, _ := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	for _, f := range reader.File {
		if f.Name == "config/auth-state.json" {
			t.Fatal("auth state should be omitted when empty")
		}
	}
}

func TestListAndPrune(t *testing.T) {
	s := newStore(t)
	dir := s.Dir()
	// 写入 5 份
	for i := 0; i < 5; i++ {
		if _, err := writeOne(s, dir, i); err != nil {
			t.Fatal(err)
		}
	}
	items, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 5 {
		t.Fatalf("want 5, got %d", len(items))
	}
	removed, err := Prune(dir, 2)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 3 {
		t.Fatalf("want 3 removed, got %d", removed)
	}
	after, _ := List(dir)
	if len(after) != 2 {
		t.Fatalf("want 2 left, got %d", len(after))
	}
}

func TestPruneKeepsNothingWhenZero(t *testing.T) {
	s := newStore(t)
	dir := s.Dir()
	_, _ = writeOne(s, dir, 0)
	removed, err := Prune(dir, 0)
	if err != nil || removed != 0 {
		t.Fatalf("keep=0 should be a no-op, got %d %v", removed, err)
	}
}

func TestManifestIsValidJSON(t *testing.T) {
	s := newStore(t)
	data, _, _ := Build(s, "b", false, nil)
	reader, _ := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	for _, f := range reader.File {
		if f.Name != "manifest.json" {
			continue
		}
		rc, _ := f.Open()
		var m map[string]any
		if err := json.NewDecoder(rc).Decode(&m); err != nil {
			t.Fatalf("manifest not json: %v", err)
		}
		rc.Close()
		if m["format"] != Format {
			t.Fatalf("format = %v", m["format"])
		}
	}
}

// writeOne 造一份小而独立的备份文件，用于列举与清理测试。
func writeOne(s *store.Store, dir string, i int) (string, error) {
	data, _, err := Build(s, "b", false, nil)
	if err != nil {
		return "", err
	}
	name := "auto-test-" + string(rune('a'+i)) + ".zip"
	path := filepathJoin(dir, "backups", name)
	if err := mkdirAll(filepathDir(path)); err != nil {
		return "", err
	}
	if err := writeFile(path, data); err != nil {
		return "", err
	}
	return name, nil
}

// Write 应与 Build 产出同样的条目，但不需要把整包攒进内存。
func TestWriteStreamsSameEntries(t *testing.T) {
	s := newStore(t)
	var buf bytes.Buffer
	manifest, err := Write(&buf, s, "stream", true, []byte(`{"enabled":true}`))
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if manifest.Events != 1 || manifest.Gifts != 1 {
		t.Fatalf("manifest wrong: %+v", manifest)
	}
	reader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	names := map[string]bool{}
	for _, f := range reader.File {
		names[f.Name] = true
	}
	for _, want := range []string{"manifest.json", "data/events.json", "data/gifts_e1.json", "config/auth-state.json"} {
		if !names[want] {
			t.Fatalf("missing %s in %v", want, names)
		}
	}
}

func filepathJoin(parts ...string) string { return filepath.Join(parts...) }
func filepathDir(path string) string      { return filepath.Dir(path) }
func mkdirAll(path string) error          { return os.MkdirAll(path, 0o775) }
func writeFile(path string, data []byte) error {
	return os.WriteFile(path, data, 0o600)
}
