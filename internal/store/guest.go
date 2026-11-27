package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// GuestEntry 是宾客扫码登记后、主家确认入库前的临时记录。
// 注意：确认之前它是**明文**存在服务器上的（服务端没有账簿密钥），
// 主家确认后由浏览器用账簿密钥加密成正式礼金，明文随即删除。
type GuestEntry struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Amount    float64 `json:"amount"`
	Relation  string  `json:"relation"`
	Note      string  `json:"note"`
	IP        string  `json:"ip,omitempty"`
	CreatedAt string  `json:"createdAt"`
}

type guestInbox map[string][]GuestEntry

func (s *Store) guestInboxPath() string {
	return filepath.Join(s.dir, "guest-inbox.json")
}

func (s *Store) readGuestInboxLocked() (guestInbox, error) {
	data, err := os.ReadFile(s.guestInboxPath())
	if err != nil {
		if os.IsNotExist(err) {
			return guestInbox{}, nil
		}
		return nil, err
	}
	items := guestInbox{}
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, err
	}
	return items, nil
}

// GuestInbox 返回某本账簿的待确认登记，超过 24 小时的条目会被顺手丢弃。
func (s *Store) GuestInbox(eventID string) ([]GuestEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.readGuestInboxLocked()
	if err != nil {
		return nil, err
	}
	kept := make([]GuestEntry, 0)
	cutoff := time.Now().Add(-24 * time.Hour)
	changed := false
	for _, entry := range items[eventID] {
		created, parseErr := time.Parse(time.RFC3339, entry.CreatedAt)
		if parseErr == nil && created.Before(cutoff) {
			changed = true
			continue
		}
		kept = append(kept, entry)
	}
	if changed {
		items[eventID] = kept
		if err := writeJSON(s.guestInboxPath(), items); err != nil {
			return nil, err
		}
	}
	return kept, nil
}

// AddGuestEntry 追加一条待确认登记；每本账簿最多 500 条，防止公开入口被灌满。
func (s *Store) AddGuestEntry(eventID string, entry GuestEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.readGuestInboxLocked()
	if err != nil {
		return err
	}
	current := items[eventID]
	if len(current) >= 500 {
		return errors.New("待确认登记已满，请主家先处理已有记录")
	}
	// 同名同金额 5 分钟内重复提交直接忽略，避免宾客连点或刷新造成重复。
	for _, old := range current {
		if old.Name == entry.Name && old.Amount == entry.Amount {
			if created, parseErr := time.Parse(time.RFC3339, old.CreatedAt); parseErr == nil && func() bool {
				d := time.Since(created)
				return d >= 0 && d < 5*time.Minute
			}() {
				return nil
			}
		}
	}
	items[eventID] = append(current, entry)
	return writeJSONMode(s.guestInboxPath(), items, 0o600)
}

// RemoveGuestEntry 主家确认或忽略后删除明文条目。
func (s *Store) RemoveGuestEntry(eventID, entryID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.readGuestInboxLocked()
	if err != nil {
		return err
	}
	current := items[eventID]
	kept := current[:0]
	found := false
	for _, entry := range current {
		if entry.ID == entryID {
			found = true
			continue
		}
		kept = append(kept, entry)
	}
	if !found {
		return errors.New("这条登记已被处理")
	}
	items[eventID] = kept
	return writeJSONMode(s.guestInboxPath(), items, 0o600)
}

// ClearGuestInbox 删除账簿的所有待确认登记（关闭扫码登记或删除账簿时调用）。
func (s *Store) ClearGuestInbox(eventID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.readGuestInboxLocked()
	if err != nil {
		return err
	}
	delete(items, eventID)
	return writeJSONMode(s.guestInboxPath(), items, 0o600)
}

func RandomGuestID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return time.Now().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(buf)
}

// BackupGuestInbox 返回全部待确认登记，用于备份。
func (s *Store) BackupGuestInbox() (map[string][]GuestEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items, err := s.readGuestInboxLocked()
	if err != nil {
		return nil, err
	}
	return map[string][]GuestEntry(items), nil
}

// ReplaceGuestInbox 在还原备份时整体替换待确认登记。
func (s *Store) ReplaceGuestInbox(items map[string][]GuestEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if items == nil {
		items = guestInbox{}
	}
	return writeJSONMode(s.guestInboxPath(), items, 0o600)
}
