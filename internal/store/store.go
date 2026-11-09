// Package store 提供基于 JSON 文件的电子礼簿存储。
//
// 布局与旧版兼容，直接把 data/ 目录指向旧部署即可读取既有账簿：
//   - data/events.json          账簿清单（map[eventID]event）
//   - data/gifts_<eventID>.json 单本账簿的礼金记录（map[giftID]gift）
//   - data/.trash/              删除的账簿备份
//
// 每次写入都先写临时文件、fsync，再原子 rename；并发写由进程内的互斥锁串行化。
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// ErrNotFound 表示账簿或礼金不存在。
var ErrNotFound = errors.New("not found")

// ErrCorrupt 表示落盘数据无法解析，调用方应拒绝继续操作以免覆盖。
var ErrCorrupt = errors.New("corrupt data")

// Record 是任意 JSON 对象，保留未知字段以便向前兼容。
type Record map[string]any

// Store 是礼簿文件存储。
type Store struct {
	dir string
	mu  sync.RWMutex
}

// Open 打开（必要时创建）数据目录。
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o775); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	return &Store{dir: dir}, nil
}

// Dir 返回数据目录的绝对路径。
func (s *Store) Dir() string { return s.dir }

func (s *Store) eventsPath() string { return filepath.Join(s.dir, "events.json") }

func (s *Store) giftsPath(eventID string) string {
	return filepath.Join(s.dir, "gifts_"+eventID+".json")
}

// ReadEvents 读取全部账簿。文件不存在时返回空 map。
func (s *Store) ReadEvents() (map[string]Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readMap(s.eventsPath())
}

// WithEvents 在写锁内读取账簿、交给 fn 修改，并在 fn 返回 changed=true 时原子落盘。
// fn 返回错误时不写盘，错误原样返回。
func (s *Store) WithEvents(fn func(events map[string]Record) (bool, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	events, err := readMap(s.eventsPath())
	if err != nil {
		return err
	}
	changed, err := fn(events)
	if err != nil {
		return err
	}
	if changed {
		return writeJSON(s.eventsPath(), events)
	}
	return nil
}

// ReadGifts 读取一本账簿的全部礼金。
func (s *Store) ReadGifts(eventID string) (map[string]Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readMap(s.giftsPath(eventID))
}

// WithGifts 在写锁内读取并修改礼金表，语义同 WithEvents。
func (s *Store) WithGifts(eventID string, fn func(gifts map[string]Record) (bool, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	gifts, err := readMap(s.giftsPath(eventID))
	if err != nil {
		return err
	}
	changed, err := fn(gifts)
	if err != nil {
		return err
	}
	if changed {
		return writeJSON(s.giftsPath(eventID), gifts)
	}
	return nil
}

// Tx 在一把写锁内同时读取账簿与指定账簿的礼金，供父账簿检查与礼金写入共用。
// 回调修改 events/gifts 后按需落盘；回调返回错误时不写盘。
// 若 withGiftFile 为 false，则不读取该账簿的礼金文件。
func (s *Store) Tx(eventID string, withGiftFile bool, fn func(events map[string]Record, gifts map[string]Record) (writeEvents, writeGifts bool, err error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	events, err := readMap(s.eventsPath())
	if err != nil {
		return err
	}
	var gifts map[string]Record
	if withGiftFile {
		gifts, err = readMap(s.giftsPath(eventID))
		if err != nil {
			return err
		}
	} else {
		gifts = map[string]Record{}
	}
	writeEv, writeGi, err := fn(events, gifts)
	if err != nil {
		return err
	}
	if writeGi {
		if err := writeJSON(s.giftsPath(eventID), gifts); err != nil {
			return err
		}
	}
	if writeEv {
		if err := writeJSON(s.eventsPath(), events); err != nil {
			return err
		}
	}
	return nil
}

// CountGifts 只统计礼金条数，不解码具体内容（用于账簿列表的人数）。
func (s *Store) CountGifts(eventID string) int {
	gifts, err := s.ReadGifts(eventID)
	if err != nil {
		return 0
	}
	return len(gifts)
}

// TrashEvent 把账簿信息与礼金文件移到 .trash/<时间>-<id>/，返回备份目录。
// 只移动礼金文件，不会删除；调用方随后负责从 events.json 中移除条目。
func (s *Store) TrashEvent(eventID string, event Record) (string, error) {
	safe := SanitizeID(eventID)
	dir := filepath.Join(s.dir, ".trash", time.Now().Format("20060102-150405")+"-"+safe)
	if err := os.MkdirAll(dir, 0o770); err != nil {
		return "", err
	}
	payload, err := json.MarshalIndent(event, "", "  ")
	if err != nil {
		return "", err
	}
	if err := writeFileAtomic(filepath.Join(dir, "event.json"), payload); err != nil {
		return "", err
	}
	if _, err := os.Stat(s.giftsPath(eventID)); err == nil {
		if err := os.Rename(s.giftsPath(eventID), filepath.Join(dir, "gifts.json")); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// RestoreTrashedGifts 在 events.json 写入失败时把礼金文件放回原位。
func (s *Store) RestoreTrashedGifts(eventID, trashDir string) {
	src := filepath.Join(trashDir, "gifts.json")
	if _, err := os.Stat(src); err == nil {
		_ = os.Rename(src, s.giftsPath(eventID))
	}
}

// BackupAll 读取全部账簿与礼金，按 ID 排序返回，用于整库备份导出。
func (s *Store) BackupAll() (map[string]Record, map[string]map[string]Record, error) {
	events, err := s.ReadEvents()
	if err != nil {
		return nil, nil, err
	}
	ids := make([]string, 0, len(events))
	for id := range events {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	gifts := make(map[string]map[string]Record, len(ids))
	for _, id := range ids {
		items, err := s.ReadGifts(id)
		if err != nil {
			return nil, nil, err
		}
		gifts[id] = items
	}
	return events, gifts, nil
}

// ReplaceAll 用给定数据整体替换现有账簿（导入备份时使用）。
// 先把全部新数据序列化并写成同目录临时文件，就绪后再把旧文件移进 .trash/、
// 统一改名切换；切换阶段失败会删掉已切换的新文件并把旧文件放回。
func (s *Store) ReplaceAll(events map[string]Record, gifts map[string]map[string]Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	type payload struct {
		path string
		data []byte
	}
	payloads := make([]payload, 0, 1+len(gifts))
	raw, err := json.MarshalIndent(events, "", "  ")
	if err != nil {
		return err
	}
	payloads = append(payloads, payload{s.eventsPath(), raw})
	for id, items := range gifts {
		raw, err := json.MarshalIndent(items, "", "  ")
		if err != nil {
			return err
		}
		payloads = append(payloads, payload{s.giftsPath(id), raw})
	}

	type staged struct{ final, tmp string }
	var ready []staged
	dropTemps := func() {
		for _, item := range ready {
			_ = os.Remove(item.tmp)
		}
	}
	for _, item := range payloads {
		tmp := item.path + "." + randomSuffix() + ".import.tmp"
		if err := writeRawFile(tmp, item.data); err != nil {
			dropTemps()
			return err
		}
		ready = append(ready, staged{item.path, tmp})
	}

	type moved struct{ from, to string }
	var backedUp []moved
	trash := filepath.Join(s.dir, ".trash", "import-"+time.Now().Format("20060102-150405"))
	if existing, err := readMap(s.eventsPath()); err == nil && len(existing) > 0 {
		if err := os.MkdirAll(trash, 0o770); err != nil {
			// 旧数据没地方放时绝不切换，否则后续出错就再也无法回滚。
			dropTemps()
			return err
		}
		if _, err := os.Stat(s.eventsPath()); err == nil {
			dst := filepath.Join(trash, "events.json")
			if os.Rename(s.eventsPath(), dst) == nil {
				backedUp = append(backedUp, moved{dst, s.eventsPath()})
			}
		}
		for id := range existing {
			src := s.giftsPath(id)
			if _, err := os.Stat(src); err == nil {
				dst := filepath.Join(trash, "gifts_"+SanitizeID(id)+".json")
				if os.Rename(src, dst) == nil {
					backedUp = append(backedUp, moved{dst, src})
				}
			}
		}
	}

	switched := make([]string, 0, len(ready))
	for _, item := range ready {
		if err := os.Rename(item.tmp, item.final); err != nil {
			for _, path := range switched {
				_ = os.Remove(path)
			}
			for _, old := range backedUp {
				_ = os.Rename(old.from, old.to)
			}
			dropTemps()
			return err
		}
		switched = append(switched, item.final)
	}
	dropTemps() // 已改名的临时文件不再存在，Remove 无副作用
	return nil
}

// writeRawFile 写一份不参与切换的临时文件，供 ReplaceAll 统一 rename。
func writeRawFile(path string, payload []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o664)
	if err != nil {
		return err
	}
	if _, err := f.Write(payload); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return err
	}
	return f.Close()
}

// ---- 内部辅助 ----

func readMap(path string) (map[string]Record, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]Record{}, nil
		}
		return nil, err
	}
	if len(raw) == 0 {
		return map[string]Record{}, nil
	}
	var out map[string]Record
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrCorrupt, filepath.Base(path))
	}
	if out == nil {
		out = map[string]Record{}
	}
	return out, nil
}

func writeJSON(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, payload)
}

func writeFileAtomic(path string, payload []byte) error {
	tmp := path + "." + randomSuffix() + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o664)
	if err != nil {
		return err
	}
	if _, err := f.Write(payload); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	syncDir(filepath.Dir(path))
	return nil
}

// syncDir 在 rename 后刷目录项，让「写临时文件 → fsync → 原子改名」真正落盘。
// Windows 无法对目录句柄 fsync，失败时静默忽略即可。
func syncDir(dir string) {
	f, err := os.Open(dir)
	if err != nil {
		return
	}
	_ = f.Sync()
	_ = f.Close()
}
