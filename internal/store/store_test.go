package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return s
}

func TestReadMissingReturnsEmpty(t *testing.T) {
	s := newStore(t)
	events, err := s.ReadEvents()
	if err != nil || len(events) != 0 {
		t.Fatalf("expected empty, got %v %v", events, err)
	}
	gifts, err := s.ReadGifts("nope")
	if err != nil || len(gifts) != 0 {
		t.Fatalf("expected empty gifts, got %v %v", gifts, err)
	}
}

func TestWithEventsPersists(t *testing.T) {
	s := newStore(t)
	err := s.WithEvents(func(events map[string]Record) (bool, error) {
		events["a"] = Record{"id": "a", "name": "测试"}
		return true, nil
	})
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	events, _ := s.ReadEvents()
	if events["a"]["name"] != "测试" {
		t.Fatalf("got %v", events)
	}
}

func TestWithEventsNoChangeSkipsWrite(t *testing.T) {
	s := newStore(t)
	_ = s.WithEvents(func(events map[string]Record) (bool, error) {
		events["a"] = Record{"id": "a"}
		return true, nil
	})
	path := filepath.Join(s.Dir(), "events.json")
	before, _ := os.Stat(path)
	_ = s.WithEvents(func(events map[string]Record) (bool, error) { return false, nil })
	after, _ := os.Stat(path)
	if !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("file rewritten when nothing changed")
	}
}

func TestCorruptFileIsRejected(t *testing.T) {
	s := newStore(t)
	if err := os.WriteFile(filepath.Join(s.Dir(), "events.json"), []byte("{oops"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadEvents(); err == nil {
		t.Fatal("expected corrupt error")
	}
	// 损坏时不能覆盖原文件
	err := s.WithEvents(func(events map[string]Record) (bool, error) { return true, nil })
	if err == nil {
		t.Fatal("expected error on corrupt data")
	}
	raw, _ := os.ReadFile(filepath.Join(s.Dir(), "events.json"))
	if string(raw) != "{oops" {
		t.Fatal("corrupt file was overwritten")
	}
}

func TestTxWritesBothFiles(t *testing.T) {
	s := newStore(t)
	err := s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
		events["e1"] = Record{"id": "e1"}
		gifts["g1"] = Record{"id": "g1", "eventId": "e1"}
		return true, true, nil
	})
	if err != nil {
		t.Fatalf("tx: %v", err)
	}
	if s.CountGifts("e1") != 1 {
		t.Fatal("gift not written")
	}
	events, _ := s.ReadEvents()
	if _, ok := events["e1"]; !ok {
		t.Fatal("event not written")
	}
}

func TestTxErrorWritesNothing(t *testing.T) {
	s := newStore(t)
	_ = s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
		events["e1"] = Record{"id": "e1"}
		return true, false, nil
	})
	err := s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
		delete(events, "e1")
		return true, true, os.ErrPermission
	})
	if err == nil {
		t.Fatal("expected error")
	}
	events, _ := s.ReadEvents()
	if _, ok := events["e1"]; !ok {
		t.Fatal("event removed despite error")
	}
}

func TestTrashEventKeepsCopy(t *testing.T) {
	s := newStore(t)
	_ = s.WithEvents(func(events map[string]Record) (bool, error) {
		events["e2"] = Record{"id": "e2", "name": "要删的"}
		return true, nil
	})
	_ = s.WithGifts("e2", func(gifts map[string]Record) (bool, error) {
		gifts["g1"] = Record{"id": "g1"}
		return true, nil
	})
	event, _ := s.ReadEvents()
	dir, err := s.TrashEvent("e2", event["e2"])
	if err != nil {
		t.Fatalf("trash: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "event.json")); err != nil {
		t.Fatal("event backup missing")
	}
	if _, err := os.Stat(filepath.Join(dir, "gifts.json")); err != nil {
		t.Fatal("gift backup missing")
	}
	if _, err := os.Stat(filepath.Join(s.Dir(), "gifts_e2.json")); !os.IsNotExist(err) {
		t.Fatal("gift file should be moved out")
	}
}

func TestBackupAndReplaceAll(t *testing.T) {
	s := newStore(t)
	_ = s.WithEvents(func(events map[string]Record) (bool, error) {
		events["e1"] = Record{"id": "e1"}
		return true, nil
	})
	_ = s.WithGifts("e1", func(gifts map[string]Record) (bool, error) {
		gifts["g1"] = Record{"id": "g1"}
		return true, nil
	})
	events, gifts, err := s.BackupAll()
	if err != nil || len(events) != 1 || len(gifts["e1"]) != 1 {
		t.Fatalf("backup: %v %v %v", events, gifts, err)
	}

	err = s.ReplaceAll(map[string]Record{"z": {"id": "z"}}, map[string]map[string]Record{"z": {}})
	if err != nil {
		t.Fatalf("replace: %v", err)
	}
	now, _ := s.ReadEvents()
	if _, ok := now["z"]; !ok || len(now) != 1 {
		t.Fatalf("replace failed: %v", now)
	}
	// 原数据应进入 .trash
	matches, _ := filepath.Glob(filepath.Join(s.Dir(), ".trash", "import-*", "events.json"))
	if len(matches) == 0 {
		t.Fatal("previous data not moved to trash")
	}
}

func TestInvalidIDRejected(t *testing.T) {
	for _, id := range []string{"", "../x", "a/b", "a b", string(make([]byte, 70))} {
		if ValidID(id) {
			t.Fatalf("id %q should be invalid", id)
		}
	}
	for _, id := range []string{"abc", "abc-_123", "OldEvent_1"} {
		if !ValidID(id) {
			t.Fatalf("id %q should be valid", id)
		}
	}
}

func TestJSONRoundTripPreservesUnknownFields(t *testing.T) {
	s := newStore(t)
	raw := `{"e1":{"id":"e1","custom":{"nested":[1,2]},"empty":{}}}`
	if err := os.WriteFile(filepath.Join(s.Dir(), "events.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = s.WithEvents(func(events map[string]Record) (bool, error) {
		events["e1"]["added"] = true
		return true, nil
	})
	out, _ := os.ReadFile(filepath.Join(s.Dir(), "events.json"))
	var parsed map[string]map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	if _, ok := parsed["e1"]["custom"]; !ok {
		t.Fatal("unknown field dropped")
	}
}

// 新数据无法序列化时，必须在动旧数据之前失败，旧账簿保持原样。
func TestReplaceAllRejectsUnserializableData(t *testing.T) {
	s := newStore(t)
	if err := s.WithEvents(func(events map[string]Record) (bool, error) {
		events["e1"] = Record{"id": "e1"}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceAll(map[string]Record{"bad": {"x": func() {}}}, nil); err == nil {
		t.Fatal("不可序列化的数据应被拒绝")
	}
	events, err := s.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := events["e1"]; !ok || len(events) != 1 {
		t.Fatalf("旧数据被破坏: %v", events)
	}
}
