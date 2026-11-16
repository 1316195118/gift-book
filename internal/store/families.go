package store

import (
	"path/filepath"
)

// 家庭空间：families.json 是家庭清单，账簿通过 event.familyId 归属家庭。
// 家庭访问码只用于「看到哪些账簿」，不参与礼金解密；账簿密码仍按原逻辑工作。

func (s *Store) familiesPath() string { return filepath.Join(s.dir, "families.json") }

// ReadFamilies 读取全部家庭。文件不存在时返回空 map。
func (s *Store) ReadFamilies() (map[string]Record, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readMap(s.familiesPath())
}

// WithFamilies 在写锁内修改家庭清单，语义同 WithEvents。
func (s *Store) WithFamilies(fn func(families map[string]Record) (bool, error)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	families, err := readMap(s.familiesPath())
	if err != nil {
		return err
	}
	changed, err := fn(families)
	if err != nil {
		return err
	}
	if changed {
		return writeJSON(s.familiesPath(), families)
	}
	return nil
}
