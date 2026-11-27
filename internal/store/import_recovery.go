package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// pendingImport 记录一次尚未完成的整库切换。
// 写入时机在「旧文件搬进 trash」之前，删除时机在「全部新文件 rename 完成」之后。
// 若进程在两者之间崩溃，下次 Open 会据此自动回滚，避免账簿全部消失。
type pendingImport struct {
	Trash string       `json:"trash"`
	Moves []importMove `json:"moves"`
	// CopyBack 为 true 时，trash 里是副本而非搬走的原件，回滚用复制而非 rename。
	CopyBack bool `json:"copyBack,omitempty"`
}

type importMove struct {
	From string `json:"from"` // trash 中的旧文件路径
	To   string `json:"to"`   // 原文件路径
}

func (s *Store) pendingImportPath() string {
	return filepath.Join(s.dir, ".import-pending.json")
}

// writePendingImport 原子写入切换标记，必须在移动任何旧文件之前完成。
func (s *Store) writePendingImport(p pendingImport) error {
	raw, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return writeRawFile(s.pendingImportPath(), raw)
}

func (s *Store) clearPendingImport() {
	_ = os.Remove(s.pendingImportPath())
}

// recoverPendingImport 在 Open 时调用：若上次切换未完成，把旧数据放回原位。
// 对每个移动项：trash 里没有旧文件说明尚未移动，跳过；有则说明旧数据已搬走，
// 先删掉可能已写入的新文件，再把旧文件还原。
func (s *Store) recoverPendingImport() error {
	raw, err := os.ReadFile(s.pendingImportPath())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var p pendingImport
	if err := json.Unmarshal(raw, &p); err != nil {
		// 标记损坏时不能盲目回滚，保留现场交人工处理。
		return errors.New("未完成的导入标记损坏，请人工检查 .trash 目录")
	}
	for _, m := range p.Moves {
		if _, statErr := os.Stat(m.From); statErr != nil {
			continue
		}
		if _, statErr := os.Stat(m.To); statErr == nil {
			if err := os.Remove(m.To); err != nil {
				return err
			}
		}
		if p.CopyBack {
			raw, readErr := os.ReadFile(m.From)
			if readErr != nil {
				return readErr
			}
			if err := writeFileAtomicMode(m.To, raw, 0o664); err != nil {
				return err
			}
		} else if err := os.Rename(m.From, m.To); err != nil {
			return err
		}
	}
	s.clearPendingImport()
	return nil
}
