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
	"regexp"
	"sort"
	"strings"
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

// ViewTx 在同一把共享读锁内复制账簿与礼金快照，解锁后再执行查询回调。
// 多个读取请求可以同时进入；写请求仍与快照读取互斥，保证不会读到半写入文件。
// 回调不得假设自己持有存储锁，也可以安全地发起后续读取。
func (s *Store) ViewTx(eventID string, fn func(events map[string]Record, gifts map[string]Record) error) error {
	s.mu.RLock()
	events, err := readMap(s.eventsPath())
	if err == nil {
		var gifts map[string]Record
		gifts, err = readMap(s.giftsPath(eventID))
		s.mu.RUnlock()
		if err != nil {
			return err
		}
		return fn(events, gifts)
	}
	s.mu.RUnlock()
	return err
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
// 只移动礼金文件，不会删除 events.json 中的条目。
func (s *Store) TrashEvent(eventID string, event Record) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.trashEventLocked(eventID, event)
}

func (s *Store) trashEventLocked(eventID string, event Record) (string, error) {
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

// DeleteEvent 在一次写锁事务里完成校验、归档礼金和移除账簿，避免在删除流程中
// 再次进入存储而等待同一个锁。失败时会把已移动的礼金恢复到原位。
func (s *Store) DeleteEvent(eventID string, validate func(event Record) error) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	events, err := readMap(s.eventsPath())
	if err != nil {
		return "", err
	}
	event, ok := events[eventID]
	if !ok {
		return "", ErrNotFound
	}
	if validate != nil {
		if err := validate(event); err != nil {
			return "", err
		}
	}
	dir, err := s.trashEventLocked(eventID, event)
	if err != nil {
		return "", err
	}
	delete(events, eventID)
	if err := writeJSON(s.eventsPath(), events); err != nil {
		s.restoreTrashedGiftsLocked(eventID, dir)
		return "", err
	}
	return dir, nil
}

// RestoreTrashedGifts 在 events.json 写入失败时把礼金文件放回原位。
func (s *Store) RestoreTrashedGifts(eventID, trashDir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.restoreTrashedGiftsLocked(eventID, trashDir)
}

func (s *Store) restoreTrashedGiftsLocked(eventID, trashDir string) {
	src := filepath.Join(trashDir, "gifts.json")
	if _, err := os.Stat(src); err == nil {
		_ = os.Rename(src, s.giftsPath(eventID))
	}
}

// ---- 回收站：列出与恢复被删除的账簿 ----

// TrashItem 描述 .trash 里的一份快照，供页面上的「回收站」展示与恢复。
type TrashItem struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"` // event：删除的单本账簿；import：备份导入前的整站快照
	EventID   string `json:"eventId"`
	EventName string `json:"eventName"`
	FamilyID  string `json:"-"` // 只用于服务端按家庭过滤，不对外暴露
	DeletedAt string `json:"deletedAt"`
	GiftCount int    `json:"giftCount"`
	Restored  bool   `json:"restored"`
}

var trashNamePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,96}$`)
var trashedEventIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (s *Store) trashPath(name string) string {
	return filepath.Join(s.dir, ".trash", name)
}

// trashTime 从目录名里取出 20060102-150405 片段，只用于展示。
func trashTime(name string) string {
	parts := strings.Split(name, "-")
	if strings.HasPrefix(name, "import-") && len(parts) >= 3 {
		return parts[1] + "-" + parts[2]
	}
	if len(parts) >= 3 {
		return parts[0] + "-" + parts[1]
	}
	return ""
}

// ---- 服务器快照：整站导入前、家庭还原前、删除家庭时留下的原始目录 ----

// RawSnapshot 是 .trash 里不提供一键恢复、但需要让管理员取回的目录。
// 这些目录是原始 JSON/zip，不是标准备份包，所以只做展示与打包下载。
type RawSnapshot struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"` // import：整站导入前；family-restore：家庭还原前；family-backups：删除家庭留下的备份
	Title     string `json:"title"`
	CreatedAt string `json:"createdAt"`
	Files     int    `json:"files"`
	Bytes     int64  `json:"bytes"`
}

// snapshotKind 只认这三种前缀，其它目录交给账簿回收站或家庭归档处理。
func snapshotKind(name string) (string, string) {
	switch {
	case strings.HasPrefix(name, "import-"):
		return "import", "整站快照（导入备份前）"
	case strings.HasPrefix(name, "family-restore-"):
		return "family-restore", "家庭还原前快照"
	case strings.HasPrefix(name, "family-backups-"):
		return "family-backups", "家庭自动备份（删除家庭时留下）"
	}
	return "", ""
}

// SnapshotDir 校验名称并返回快照目录的绝对路径。
// 带 family.json 的目录属于「家庭归档」，由家庭归档面板负责，这里一律不认。
func (s *Store) SnapshotDir(name string) (string, error) {
	if !trashNamePattern.MatchString(name) {
		return "", ErrNotFound
	}
	if kind, _ := snapshotKind(name); kind == "" {
		return "", ErrNotFound
	}
	dir := s.trashPath(name)
	if _, err := os.Stat(filepath.Join(dir, "family.json")); err == nil {
		return "", ErrNotFound
	}
	return dir, nil
}

// DeleteRawSnapshot 删除一份服务器快照。名称校验与下载共用 SnapshotDir，
// 带 family.json 的家庭归档、以及不在白名单里的目录一律拒绝。
func (s *Store) DeleteRawSnapshot(name string) error {
	dir, err := s.SnapshotDir(name)
	if err != nil {
		return err
	}
	return os.RemoveAll(dir)
}

// snapshotTime 从目录名里取出 20060102-150405 片段，取不到就用目录修改时间。
var snapshotStampPattern = regexp.MustCompile(`(\d{8}-\d{6})`)

func snapshotTime(name string, info os.FileInfo) string {
	if match := snapshotStampPattern.FindStringSubmatch(name); match != nil {
		return match[1]
	}
	return info.ModTime().Format("20060102-150405")
}

// ListRawSnapshots 列出可下载的服务器快照，按目录名倒序（新的在前）。
func (s *Store) ListRawSnapshots() ([]RawSnapshot, error) {
	entries, err := os.ReadDir(filepath.Join(s.dir, ".trash"))
	if err != nil {
		if os.IsNotExist(err) {
			return []RawSnapshot{}, nil
		}
		return nil, err
	}
	out := make([]RawSnapshot, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		kind, title := snapshotKind(name)
		if kind == "" || !trashNamePattern.MatchString(name) {
			continue
		}
		dir := s.trashPath(name)
		// 家庭归档（删家庭时生成）带 family.json，归「家庭归档」面板，不算服务器快照；
		// 这条判断也顺带避开「家庭名恰好叫 restore / backups」造成的目录名撞车。
		if _, err := os.Stat(filepath.Join(dir, "family.json")); err == nil {
			continue
		}
		snapshot := RawSnapshot{Name: name, Kind: kind, Title: title}
		if info, statErr := entry.Info(); statErr == nil {
			snapshot.CreatedAt = snapshotTime(name, info)
		}
		if files, readErr := os.ReadDir(dir); readErr == nil {
			for _, file := range files {
				if file.IsDir() {
					continue
				}
				snapshot.Files++
				if info, infoErr := file.Info(); infoErr == nil {
					snapshot.Bytes += info.Size()
				}
			}
		}
		if snapshot.Files == 0 {
			continue
		}
		out = append(out, snapshot)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	return out, nil
}

// ListTrash 只读扫描 .trash；无法识别的目录一律跳过，不影响主流程。
func (s *Store) ListTrash() ([]TrashItem, error) {
	entries, err := os.ReadDir(filepath.Join(s.dir, ".trash"))
	if os.IsNotExist(err) {
		return []TrashItem{}, nil
	}
	if err != nil {
		return nil, err
	}
	items := make([]TrashItem, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !trashNamePattern.MatchString(entry.Name()) {
			continue
		}
		dir := s.trashPath(entry.Name())
		item := TrashItem{Name: entry.Name(), DeletedAt: trashTime(entry.Name())}
		if _, err := os.Stat(filepath.Join(dir, "restored")); err == nil {
			item.Restored = true
		}
		if strings.HasPrefix(entry.Name(), "import-") {
			item.Kind = "import"
			item.EventName = "整站快照（备份导入前）"
			if events, readErr := readMap(filepath.Join(dir, "events.json")); readErr == nil {
				item.GiftCount = len(events)
			}
		} else {
			raw, readErr := os.ReadFile(filepath.Join(dir, "event.json"))
			if readErr != nil {
				continue
			}
			var event Record
			if json.Unmarshal(raw, &event) != nil {
				continue
			}
			item.Kind = "event"
			item.EventID, _ = event["id"].(string)
			item.EventName, _ = event["name"].(string)
			item.FamilyID, _ = event["familyId"].(string)
			if !trashedEventIDPattern.MatchString(item.EventID) {
				continue
			}
			if gifts, giftErr := readMap(filepath.Join(dir, "gifts.json")); giftErr == nil {
				item.GiftCount = len(gifts)
			}
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name > items[j].Name })
	return items, nil
}

// ReadTrashedEvent 读取单本账簿快照里的账簿信息，供恢复接口在做任何改动前校验管理密码。
func (s *Store) ReadTrashedEvent(name string) (Record, error) {
	if !trashNamePattern.MatchString(name) || strings.HasPrefix(name, "import-") {
		return nil, ErrNotFound
	}
	raw, err := os.ReadFile(filepath.Join(s.trashPath(name), "event.json"))
	if err != nil {
		return nil, ErrNotFound
	}
	var event Record
	if json.Unmarshal(raw, &event) != nil {
		return nil, ErrCorrupt
	}
	return event, nil
}

// RestoreTrash 恢复一份被删除的单本账簿快照。
// 快照原件保留不动（可再次恢复）；整站导入快照不提供一键恢复，避免覆盖现有全部账簿。
func (s *Store) RestoreTrash(name string) (string, string, error) {
	if !trashNamePattern.MatchString(name) || strings.HasPrefix(name, "import-") {
		return "", "", ErrNotFound
	}
	dir := s.trashPath(name)
	raw, err := os.ReadFile(filepath.Join(dir, "event.json"))
	if err != nil {
		return "", "", ErrNotFound
	}
	var event Record
	if json.Unmarshal(raw, &event) != nil {
		return "", "", ErrCorrupt
	}
	id, _ := event["id"].(string)
	eventName, _ := event["name"].(string)
	if !trashedEventIDPattern.MatchString(id) {
		return "", "", ErrCorrupt
	}

	// 先把礼金快照读好并校验，损坏时绝不写入任何文件。
	var giftMap map[string]Record
	giftRaw, giftErr := os.ReadFile(filepath.Join(dir, "gifts.json"))
	if giftErr == nil && json.Unmarshal(giftRaw, &giftMap) != nil {
		return "", "", ErrCorrupt
	}

	// 同名检查必须在写礼金之前，且与账簿登记共用同一把锁：
	// 否则恢复被拒绝时礼金文件也已经被快照覆盖，现有账簿会静默丢数据。
	err = s.WithEvents(func(events map[string]Record) (bool, error) {
		if _, exists := events[id]; exists {
			return false, errors.New("同名账簿已存在，无需恢复")
		}
		// 目标位置若残留同名礼金文件，先留一份在快照目录里再覆盖。
		if _, statErr := os.Stat(s.giftsPath(id)); statErr == nil {
			if old, readErr := os.ReadFile(s.giftsPath(id)); readErr == nil {
				_ = writeFileAtomic(filepath.Join(dir, "gifts-before-restore.json"), old)
			}
		}
		if giftErr == nil {
			if writeErr := writeFileAtomic(s.giftsPath(id), giftRaw); writeErr != nil {
				return false, writeErr
			}
		}
		events[id] = event
		return true, nil
	})
	if err != nil {
		return "", "", err
	}
	_ = writeFileAtomic(filepath.Join(dir, "restored"), []byte(time.Now().Format("2006-01-02 15:04:05")))
	return id, eventName, nil
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

// DefaultFamilyID 是升级前所有账簿的归属家庭。
const DefaultFamilyID = "fam_default"

// eventFamilyID 返回账簿所属家庭；旧数据没有 familyId 时归入默认家庭。
func eventFamilyID(event Record) string {
	id, _ := event["familyId"].(string)
	if id == "" {
		return DefaultFamilyID
	}
	return id
}

// BackupFamily 读取指定家庭的账簿与礼金，按 ID 排序返回，用于家庭级备份导出。
func (s *Store) BackupFamily(familyID string) (map[string]Record, map[string]map[string]Record, error) {
	all, err := s.ReadEvents()
	if err != nil {
		return nil, nil, err
	}
	events := make(map[string]Record)
	ids := make([]string, 0)
	for id, event := range all {
		if eventFamilyID(event) != familyID {
			continue
		}
		events[id] = event
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

// ReplaceFamily 只用备份数据替换指定家庭的账簿，其他家庭原样保留。
func (s *Store) ReplaceFamily(familyID string, events map[string]Record, gifts map[string]map[string]Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := readMap(s.eventsPath())
	if err != nil {
		return err
	}
	oldIDs := make([]string, 0)
	next := make(map[string]Record, len(current)+len(events))
	for id, event := range current {
		if eventFamilyID(event) == familyID {
			oldIDs = append(oldIDs, id)
			continue
		}
		if _, conflict := events[id]; conflict {
			return errors.New("备份包与现有账簿编号冲突")
		}
		next[id] = event
	}
	for id, event := range events {
		event["familyId"] = familyID
		next[id] = event
	}

	// 只给当前家庭的旧礼金留一份回滚副本，不碰其它家庭。
	trash := filepath.Join(s.dir, ".trash", "family-restore-"+time.Now().Format("20060102-150405")+"-"+randomSuffix())
	oldExisted := map[string]bool{}
	if len(oldIDs) > 0 {
		if err := os.MkdirAll(trash, 0o770); err != nil {
			return err
		}
		oldEvents := make(map[string]Record, len(oldIDs))
		for _, id := range oldIDs {
			oldEvents[id] = current[id]
			src := s.giftsPath(id)
			raw, readErr := os.ReadFile(src)
			if readErr == nil {
				oldExisted[id] = true
				if err := writeFileAtomic(filepath.Join(trash, "gifts_"+SanitizeID(id)+".json"), raw); err != nil {
					return err
				}
			}
		}
		raw, err := json.MarshalIndent(oldEvents, "", "  ")
		if err != nil {
			return err
		}
		if err := writeFileAtomic(filepath.Join(trash, "events.json"), raw); err != nil {
			return err
		}
	}

	rollback := func() {
		for _, id := range oldIDs {
			src := filepath.Join(trash, "gifts_"+SanitizeID(id)+".json")
			if oldExisted[id] {
				_ = os.Rename(src, s.giftsPath(id))
			} else {
				_ = os.Remove(s.giftsPath(id))
			}
		}
		for id := range events {
			if !oldExisted[id] {
				_ = os.Remove(s.giftsPath(id))
			}
		}
	}

	type staged struct{ final, tmp string }
	ready := make([]staged, 0, len(events))
	for id := range events {
		items := gifts[id]
		if items == nil {
			items = map[string]Record{}
		}
		raw, err := json.MarshalIndent(items, "", "  ")
		if err != nil {
			for _, item := range ready {
				_ = os.Remove(item.tmp)
			}
			return err
		}
		tmp := s.giftsPath(id) + "." + randomSuffix() + ".restore.tmp"
		if err := writeRawFile(tmp, raw); err != nil {
			for _, item := range ready {
				_ = os.Remove(item.tmp)
			}
			return err
		}
		ready = append(ready, staged{s.giftsPath(id), tmp})
	}
	for _, item := range ready {
		if err := os.Rename(item.tmp, item.final); err != nil {
			for _, other := range ready {
				_ = os.Remove(other.tmp)
			}
			rollback()
			return err
		}
	}
	if err := writeJSON(s.eventsPath(), next); err != nil {
		rollback()
		return err
	}
	// 备份里没有的旧账簿：礼金文件已在 trash 里，删除主目录副本。
	for _, id := range oldIDs {
		if _, keep := events[id]; !keep {
			_ = os.Remove(s.giftsPath(id))
		}
	}
	// trash 不删：家庭还原会覆盖本家庭全部账簿，和整站还原一样留一份快照，
	// 万一选错了备份包还能从 .trash/family-restore-* 人工取回。
	return nil
}

// ArchiveFamily 把指定家庭的账簿与礼金移入 .trash/family-<name>-<时间>/，
// 返回移走的账簿数与目录名。数据不删除，便于管理员事后人工取回。
func (s *Store) ArchiveFamily(familyID, familyName string) (int, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	events, err := readMap(s.eventsPath())
	if err != nil {
		return 0, "", err
	}
	ids := make([]string, 0)
	selected := make(map[string]Record)
	for id, event := range events {
		if eventFamilyID(event) != familyID {
			continue
		}
		ids = append(ids, id)
		selected[id] = event
	}
	if len(ids) == 0 {
		return 0, "", nil
	}
	sort.Strings(ids)
	name := "family-" + sanitizeDirName(familyName) + "-" + time.Now().Format("20060102-150405")
	dir := filepath.Join(s.dir, ".trash", name)
	// 同名家庭在同一秒内被删两次时，目录名会撞在一起：
	// MkdirAll 对已存在目录不报错，后一次会直接覆盖前一次的归档。
	if _, statErr := os.Stat(dir); statErr == nil {
		name += "-" + randomSuffix()
		dir = filepath.Join(s.dir, ".trash", name)
	}
	if err := os.MkdirAll(dir, 0o770); err != nil {
		return 0, "", err
	}
	raw, err := json.MarshalIndent(selected, "", "  ")
	if err != nil {
		return 0, "", err
	}
	if err := writeFileAtomic(filepath.Join(dir, "events.json"), raw); err != nil {
		return 0, "", err
	}
	meta, _ := json.MarshalIndent(Record{
		"id":         familyID,
		"name":       familyName,
		"archivedAt": time.Now().Format("2006-01-02 15:04:05"),
	}, "", "  ")
	_ = writeFileAtomic(filepath.Join(dir, "family.json"), meta)
	moved := make([]string, 0, len(ids))
	for _, id := range ids {
		src := s.giftsPath(id)
		if _, statErr := os.Stat(src); statErr == nil {
			if err := os.Rename(src, filepath.Join(dir, "gifts_"+SanitizeID(id)+".json")); err != nil {
				// 已移走的礼金放回去，避免事件清单还在、礼金文件却不见了。
				for _, back := range moved {
					_ = os.Rename(filepath.Join(dir, "gifts_"+SanitizeID(back)+".json"), s.giftsPath(back))
				}
				return 0, "", err
			}
			moved = append(moved, id)
		}
		delete(events, id)
	}
	if err := writeJSON(s.eventsPath(), events); err != nil {
		for _, back := range moved {
			_ = os.Rename(filepath.Join(dir, "gifts_"+SanitizeID(back)+".json"), s.giftsPath(back))
		}
		return 0, "", err
	}
	return len(ids), name, nil
}

func sanitizeDirName(name string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|', '\n', '\r', '\t', ' ':
			return '-'
		}
		return r
	}, strings.TrimSpace(name))
	if cleaned == "" {
		return "family"
	}
	runes := []rune(cleaned)
	if len(runes) > 30 {
		cleaned = string(runes[:30])
	}
	return cleaned
}

// ReplaceAll 用给定数据整体替换现有账簿（导入备份时使用）。
// 先把全部新数据序列化并写成同目录临时文件，就绪后再把旧文件移进 .trash/、
// 统一改名切换；切换阶段失败会删掉已切换的新文件并把旧文件放回。
func (s *Store) ReplaceAll(events map[string]Record, gifts map[string]map[string]Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.replaceAllLocked(events, gifts, nil)
}

// ReplaceAllWithFamilies 在 ReplaceAll 的基础上把家庭清单一起纳入同一次切换：
// 账簿、礼金与 families.json 要么全部换成新的，要么全部保持原样。
// 整站还原必须走这里，否则家庭清单写失败会留下「新账簿 + 旧家庭」的中间状态，
// 那些归属新家庭的账簿会因为家庭不存在而谁也看不到。
func (s *Store) ReplaceAllWithFamilies(events map[string]Record, gifts map[string]map[string]Record, families map[string]Record) error {
	if families == nil {
		return s.ReplaceAll(events, gifts)
	}
	if _, ok := families[DefaultFamilyID]; !ok {
		return errors.New("备份包缺少默认家庭")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.replaceAllLocked(events, gifts, families)
}

func (s *Store) replaceAllLocked(events map[string]Record, gifts map[string]map[string]Record, families map[string]Record) error {
	type payload struct {
		path string
		data []byte
	}
	payloads := make([]payload, 0, 2+len(gifts))
	raw, err := json.MarshalIndent(events, "", "  ")
	if err != nil {
		return err
	}
	payloads = append(payloads, payload{s.eventsPath(), raw})
	if families != nil {
		familiesRaw, err := json.MarshalIndent(families, "", "  ")
		if err != nil {
			return err
		}
		payloads = append(payloads, payload{s.familiesPath(), familiesRaw})
	}
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
	existing, existingErr := readMap(s.eventsPath())
	if existingErr != nil {
		existing = map[string]Record{}
	}
	// 要搬走的礼金文件按账簿 ID 列表来定；events.json 读不出来时改成直接扫文件名，
	// 否则切换会把那些礼金原地覆盖，连回滚副本都没有。
	giftIDs := make([]string, 0, len(existing))
	for id := range existing {
		giftIDs = append(giftIDs, id)
	}
	if existingErr != nil {
		if entries, readErr := os.ReadDir(s.dir); readErr == nil {
			for _, entry := range entries {
				name := entry.Name()
				if entry.IsDir() || !strings.HasPrefix(name, "gifts_") || !strings.HasSuffix(name, ".json") {
					continue
				}
				giftIDs = append(giftIDs, strings.TrimSuffix(strings.TrimPrefix(name, "gifts_"), ".json"))
			}
		}
	}
	familiesExist := false
	if families != nil {
		if _, statErr := os.Stat(s.familiesPath()); statErr == nil {
			familiesExist = true
		}
	}
	// 旧数据只要有任何一部分会被覆盖，就先整体挪进 .trash 再切换：
	// 切换阶段出错能原样放回，成功后也留下一份可人工取回的快照。
	if len(existing) > 0 || len(giftIDs) > 0 || familiesExist {
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
		for _, id := range giftIDs {
			src := s.giftsPath(id)
			if _, err := os.Stat(src); err != nil {
				continue
			}
			dst := filepath.Join(trash, "gifts_"+SanitizeID(id)+".json")
			if os.Rename(src, dst) == nil {
				backedUp = append(backedUp, moved{dst, src})
			}
		}
		if familiesExist {
			dst := filepath.Join(trash, "families.json")
			if os.Rename(s.familiesPath(), dst) == nil {
				backedUp = append(backedUp, moved{dst, s.familiesPath()})
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
