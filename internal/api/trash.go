package api

import (
	"errors"
	"net/http"

	"giftbook/internal/store"
)

// ---- GET /api/trash ----
// 只读列出 data/.trash 里能识别的快照，供首页「回收站」展示。

func (s *Server) handleListTrash(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListTrash()
	if err != nil {
		fail(w, http.StatusInternalServerError, "回收站读取失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: items})
}

// ---- POST /api/trash/restore/{name} ----
// 只恢复「删除的单本账簿」快照；整站导入快照需从首页备份自行判断，避免一键覆盖现有账簿。

func (s *Server) handleRestoreTrash(w http.ResponseWriter, r *http.Request) {
	id, eventName, err := s.store.RestoreTrash(r.PathValue("name"))
	if err != nil {
		switch {
		case errors.Is(err, store.ErrNotFound):
			fail(w, http.StatusNotFound, "这份备份不在回收站里，或不是可恢复的单本账簿")
		case errors.Is(err, store.ErrCorrupt):
			fail(w, http.StatusBadRequest, "这份备份已损坏，无法恢复")
		default:
			fail(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	s.notifyChange(r, "event", "restored", id, "")
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]string{
		"id":        id,
		"eventName": eventName,
	}})
}
