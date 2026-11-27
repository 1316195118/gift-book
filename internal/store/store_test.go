package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
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

func TestViewTxReleasesReadLockBeforeCallback(t *testing.T) {
	s := newStore(t)
	if err := s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
		events["e1"] = Record{"id": "e1"}
		gifts["g1"] = Record{"id": "g1"}
		return true, true, nil
	}); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		done <- s.ViewTx("e1", func(events, gifts map[string]Record) error {
			if _, ok := events["e1"]; !ok {
				return fmt.Errorf("账簿快照缺失")
			}
			if _, ok := gifts["g1"]; !ok {
				return fmt.Errorf("礼金快照缺失")
			}
			// 回调开始时读锁必须已释放，否则这里会等待同一个存储锁。
			return s.WithEvents(func(latest map[string]Record) (bool, error) {
				latest["e1"]["checked"] = true
				return true, nil
			})
		})
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ViewTx 在回调期间仍持有读锁")
	}
	events, err := s.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if events["e1"]["checked"] != true {
		t.Fatalf("回调内的后续写入没有生效: %v", events)
	}
}

func TestViewTxConcurrentReaders(t *testing.T) {
	s := newStore(t)
	if err := s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
		events["e1"] = Record{"id": "e1"}
		for i := 0; i < 20; i++ {
			id := fmt.Sprintf("g%02d", i)
			gifts[id] = Record{"id": id, "eventId": "e1"}
		}
		return true, true, nil
	}); err != nil {
		t.Fatal(err)
	}

	const readers = 64
	start := make(chan struct{})
	errs := make(chan error, readers)
	var wg sync.WaitGroup
	wg.Add(readers)
	for i := 0; i < readers; i++ {
		go func() {
			defer wg.Done()
			<-start
			errs <- s.ViewTx("e1", func(events, gifts map[string]Record) error {
				if _, ok := events["e1"]; !ok {
					return fmt.Errorf("账簿快照缺失")
				}
				if len(gifts) != 20 {
					return fmt.Errorf("礼金快照应为 20 条，得到 %d", len(gifts))
				}
				return nil
			})
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestConcurrentViewTxAndWritesRemainConsistent(t *testing.T) {
	s := newStore(t)
	if err := s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
		events["e1"] = Record{"id": "e1"}
		return true, false, nil
	}); err != nil {
		t.Fatal(err)
	}

	const writers = 24
	const readers = 24
	start := make(chan struct{})
	errs := make(chan error, writers+readers)
	var wg sync.WaitGroup
	wg.Add(writers + readers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			defer wg.Done()
			<-start
			id := fmt.Sprintf("g%02d", i)
			errs <- s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
				if _, ok := events["e1"]; !ok {
					return false, false, fmt.Errorf("写入时账簿缺失")
				}
				gifts[id] = Record{"id": id, "eventId": "e1"}
				return false, true, nil
			})
		}(i)
	}
	for i := 0; i < readers; i++ {
		go func() {
			defer wg.Done()
			<-start
			for j := 0; j < 20; j++ {
				err := s.ViewTx("e1", func(events, gifts map[string]Record) error {
					if _, ok := events["e1"]; !ok {
						return fmt.Errorf("读取时账簿缺失")
					}
					for id := range gifts {
						if id == "" {
							return fmt.Errorf("读到空礼金编号")
						}
					}
					return nil
				})
				if err != nil {
					errs <- err
					return
				}
			}
			errs <- nil
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	gifts, err := s.ReadGifts("e1")
	if err != nil {
		t.Fatal(err)
	}
	if len(gifts) != writers {
		t.Fatalf("并发写入后应保留 %d 条礼金，实际 %d", writers, len(gifts))
	}
}

func TestDeleteEventIsAtomicAndArchivesGifts(t *testing.T) {
	s := newStore(t)
	if err := s.Tx("e1", true, func(events, gifts map[string]Record) (bool, bool, error) {
		events["e1"] = Record{"id": "e1", "name": "待删除"}
		gifts["g1"] = Record{"id": "g1", "eventId": "e1"}
		return true, true, nil
	}); err != nil {
		t.Fatal(err)
	}
	dir, err := s.DeleteEvent("e1", func(event Record) error {
		if event["name"] != "待删除" {
			return fmt.Errorf("校验回调收到错误账簿")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "event.json")); err != nil {
		t.Fatal("回收站缺少账簿快照")
	}
	if _, err := os.Stat(filepath.Join(dir, "gifts.json")); err != nil {
		t.Fatal("回收站缺少礼金快照")
	}
	events, err := s.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := events["e1"]; ok {
		t.Fatal("删除后账簿仍在主清单")
	}
	if _, err := os.Stat(filepath.Join(s.Dir(), "gifts_e1.json")); !os.IsNotExist(err) {
		t.Fatal("删除后礼金文件仍在主目录")
	}
	if _, err := s.DeleteEvent("e1", nil); err != ErrNotFound {
		t.Fatalf("重复删除应返回 ErrNotFound，实际 %v", err)
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

func TestRestoreTrashKeepsExistingGifts(t *testing.T) {
	s := newStore(t)
	event := Record{"id": "ev1", "name": "原账簿"}
	_ = s.WithEvents(func(events map[string]Record) (bool, error) {
		events["ev1"] = event
		return true, nil
	})
	_ = s.WithGifts("ev1", func(gifts map[string]Record) (bool, error) {
		gifts["g-old"] = Record{"id": "g-old", "name": "旧礼金"}
		return true, nil
	})
	dir, err := s.TrashEvent("ev1", event)
	if err != nil {
		t.Fatal(err)
	}
	_ = s.WithEvents(func(events map[string]Record) (bool, error) {
		delete(events, "ev1")
		return true, nil
	})
	// 同名账簿重建并写入不同的礼金。
	_ = s.WithEvents(func(events map[string]Record) (bool, error) {
		events["ev1"] = Record{"id": "ev1", "name": "新建账簿"}
		return true, nil
	})
	_ = s.WithGifts("ev1", func(gifts map[string]Record) (bool, error) {
		gifts["g-new"] = Record{"id": "g-new", "name": "新礼金"}
		return true, nil
	})
	if _, _, err := s.RestoreTrash(filepath.Base(dir)); err == nil {
		t.Fatal("同名账簿已存在时应当拒绝恢复")
	}
	gifts, _ := s.ReadGifts("ev1")
	if len(gifts) != 1 || gifts["g-new"] == nil {
		t.Fatalf("恢复被拒绝后现有礼金被覆盖或丢失：%v", gifts)
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

func TestCountGiftsManyCachesAndTracksExternalChanges(t *testing.T) {
	s := newStore(t)
	_ = s.WithGifts("e1", func(gifts map[string]Record) (bool, error) {
		for i := 0; i < 3; i++ {
			id := fmt.Sprintf("g%d", i)
			gifts[id] = Record{"id": id}
		}
		return true, nil
	})
	counts := s.CountGiftsMany([]string{"e1", "missing"})
	if counts["e1"] != 3 || counts["missing"] != 0 {
		t.Fatalf("计数结果错误: %v", counts)
	}

	// 缓存命中不会改变结果。
	if got := s.CountGifts("e1"); got != 3 {
		t.Fatalf("缓存后计数错误: %d", got)
	}

	// 外部工具直接替换 JSON 时，靠 size + ModTime 重新计数。
	path := filepath.Join(s.Dir(), "gifts_e1.json")
	if err := os.WriteFile(path, []byte(`{"a":{"id":"a"},"b":{"id":"b"}}`), 0o664); err != nil {
		t.Fatal(err)
	}
	counts = s.CountGiftsMany([]string{"e1"})
	if counts["e1"] != 2 {
		t.Fatalf("外部替换后计数未刷新: %v", counts)
	}

	// 写锁与批量计数互斥；并发读写不丢失或覆盖计数结果。
	errs := make(chan error, 32)
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("g%02d", i)
			errs <- s.WithGifts("e1", func(gifts map[string]Record) (bool, error) {
				gifts[id] = Record{"id": id}
				return true, nil
			})
		}(i)
	}
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			counts := s.CountGiftsMany([]string{"e1"})
			if counts["e1"] < 2 {
				errs <- fmt.Errorf("并发计数异常: %d", counts["e1"])
			} else {
				errs <- nil
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := s.CountGifts("e1"); got != 18 {
		t.Fatalf("并发写入后应保留 18 条礼金，实际 %d", got)
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

// 备份快照必须在单锁内读到一致的 events/gifts，不能出现账簿存在但礼金文件缺失的撕裂。
func TestBackupBundleConsistentUnderWrites(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.WithEvents(func(events map[string]Record) (bool, error) {
		events["e1"] = Record{"name": "宴", "familyId": DefaultFamilyID}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.WithGifts("e1", func(gifts map[string]Record) (bool, error) {
		gifts["g1"] = Record{"amount": 100.0}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 100; i += 1 {
			_ = st.WithEvents(func(events map[string]Record) (bool, error) {
				e := events["e1"]
				e["name"] = "宴"
				events["e1"] = e
				return true, nil
			})
			_ = st.WithGifts("e1", func(gifts map[string]Record) (bool, error) {
				gifts["g1"] = Record{"amount": float64(i)}
				return true, nil
			})
		}
	}()

	for i := 0; i < 50; i += 1 {
		bundle, err := st.ReadBackupBundle("")
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := bundle.Events["e1"]; !ok {
			t.Fatal("快照中账簿丢失")
		}
		if len(bundle.Gifts["e1"]) == 0 {
			t.Fatal("快照中礼金缺失")
		}
	}
	<-done
}

// 模拟切换中途崩溃：旧文件已进 trash、新文件已写入，重启后应自动回滚。
func TestRecoverPendingImport(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.WithEvents(func(events map[string]Record) (bool, error) {
		events["e1"] = Record{"name": "原始账簿"}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.WithGifts("e1", func(gifts map[string]Record) (bool, error) {
		gifts["g1"] = Record{"amount": 100.0}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}

	// 手工制造崩溃现场：events.json 已被新的替换，旧的在 .trash 里。
	trash := filepath.Join(dir, ".trash", "import-crash")
	if err := os.MkdirAll(trash, 0o770); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(dir, "events.json"), filepath.Join(trash, "events.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "events.json"), []byte(`{"new": {"name": "新账簿"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	marker := pendingImport{
		Trash: trash,
		Moves: []importMove{{filepath.Join(trash, "events.json"), filepath.Join(dir, "events.json")}},
	}
	raw, _ := json.MarshalIndent(marker, "", "  ")
	if err := os.WriteFile(st.pendingImportPath(), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	// 重新打开应自动回滚
	st2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	events, err := st2.ReadEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("回滚后应只剩原账簿，实际 %v", events)
	}
	if _, ok := events["e1"]; !ok {
		t.Fatalf("原账簿未恢复: %v", events)
	}
	if _, err := os.Stat(st2.pendingImportPath()); !os.IsNotExist(err) {
		t.Fatal("回滚成功后应清除标记")
	}
}

// ReplaceFamily 的 trash 是副本，回滚后副本必须仍在，便于人工取回。
func TestRecoverPendingImportCopyBack(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	backupPath := filepath.Join(dir, "gift_backup.json")
	if err := os.WriteFile(backupPath, []byte(`{"g1":{"amount":100}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	trash := filepath.Join(dir, ".trash", "family-restore-crash")
	if err := os.MkdirAll(trash, 0o770); err != nil {
		t.Fatal(err)
	}
	copyPath := filepath.Join(trash, "gifts_e1.json")
	if err := os.WriteFile(copyPath, []byte(`{"g1":{"amount":100}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	// 主目录里是崩溃时写入的新数据
	target := filepath.Join(dir, "gifts_e1.json")
	if err := os.WriteFile(target, []byte(`{"g2":{"amount":999}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	marker := pendingImport{
		Trash:    trash,
		Moves:    []importMove{{copyPath, target}},
		CopyBack: true,
	}
	raw, _ := json.MarshalIndent(marker, "", "  ")
	if err := os.WriteFile(st.pendingImportPath(), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	st2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := st2.ReadGifts("e1")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got["g1"]; !ok {
		t.Fatalf("副本回滚失败: %v", got)
	}
	if _, ok := got["g2"]; ok {
		t.Fatal("新数据应被旧副本覆盖")
	}
	if _, err := os.Stat(copyPath); err != nil {
		t.Fatal("回滚后 trash 副本应保留")
	}
	if _, err := os.Stat(st2.pendingImportPath()); !os.IsNotExist(err) {
		t.Fatal("应清除标记")
	}
}

// 写入后缓存应命中：直接改磁盘文件（模拟外部进程）不会被读到，
// 直到 mtime/size 变化触发失效。
func TestGiftCacheHitAndInvalidate(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.WithGifts("e1", func(g map[string]Record) (bool, error) {
		g["g1"] = Record{"amount": 100.0}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	// 缓存命中：读到写入的值
	gifts, err := st.ReadGifts("e1")
	if err != nil || len(gifts) != 1 {
		t.Fatalf("缓存读取失败: %v %v", gifts, err)
	}
	// 返回的副本被修改不应污染缓存
	gifts["g2"] = Record{"amount": 999.0}
	gifts2, _ := st.ReadGifts("e1")
	if len(gifts2) != 1 {
		t.Fatal("返回的 map 被外部修改污染了缓存")
	}
	// 外部改写文件后，失效再读应拿到新内容
	st.invalidateGiftCache()
	if err := st.WithGifts("e1", func(g map[string]Record) (bool, error) {
		g["g3"] = Record{"amount": 300.0}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	gifts3, _ := st.ReadGifts("e1")
	if len(gifts3) != 2 {
		t.Fatalf("失效后应读到 2 条，实际 %d", len(gifts3))
	}
}

// 回收站归档会让礼金文件移走，缓存必须失效，否则还能读到已删除的账簿礼金。
func TestGiftCacheInvalidateOnTrash(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.WithEvents(func(events map[string]Record) (bool, error) {
		events["e1"] = Record{"name": "宴"}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.WithGifts("e1", func(g map[string]Record) (bool, error) {
		g["g1"] = Record{"amount": 100.0}
		return true, nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.TrashEvent("e1", Record{"name": "宴"}); err != nil {
		t.Fatal(err)
	}
	gifts, err := st.ReadGifts("e1")
	if err != nil {
		t.Fatal(err)
	}
	if len(gifts) != 0 {
		t.Fatalf("归档后不应再缓存旧礼金，实际 %v", gifts)
	}
}
