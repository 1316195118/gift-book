package api

import (
	"archive/zip"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"giftbook/internal/store"
)

// ---- GET /api/trash ----
// 只读列出 data/.trash 里能识别的快照，供首页「回收站」展示。

func (s *Server) handleListTrash(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	items, err := s.store.ListTrash()
	if err != nil {
		fail(w, http.StatusInternalServerError, "回收站读取失败")
		return
	}
	// 只列出当前家庭的账簿快照；整站导入快照不提供一键恢复，统一交给站点管理员。
	filtered := make([]store.TrashItem, 0, len(items))
	for _, item := range items {
		if item.Kind != "event" {
			continue
		}
		owner := item.FamilyID
		if owner == "" {
			// 升级前的快照没有 familyId，归默认家庭，不能对其它家庭可见。
			owner = store.DefaultFamilyID
		}
		if owner == family.ID {
			filtered = append(filtered, item)
		}
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: filtered})
}

// ---- POST /api/trash/restore/{name} ----
// 只恢复「删除的单本账簿」快照；整站导入快照需从首页备份自行判断，避免一键覆盖现有账簿。

func (s *Server) handleRestoreTrash(w http.ResponseWriter, r *http.Request) {
	family, ok := s.requireFamily(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	// 恢复有密码账簿必须与删除时一样校验管理密码；快照里的 verifier 与删除前一致。
	event, err := s.store.ReadTrashedEvent(name)
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
	if !eventBelongsTo(event, family.ID) {
		fail(w, http.StatusNotFound, "这份备份不在回收站里，或不是可恢复的单本账簿")
		return
	}
	if !s.requireLedgerKey(w, r, event) {
		return
	}
	id, eventName, err := s.store.RestoreTrash(name)
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

// ---- 服务器快照：整站导入前、家庭还原前、删除家庭时留下的原始目录 ----
// 这些目录不是标准备份包，不能一键还原（会绕过家庭与账簿的校验），
// 但此前只能上服务器用命令行取回，这里补上「看得到、下得走」。

func (s *Server) handleListSnapshots(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以查看服务器快照")
		return
	}
	items, err := s.store.ListRawSnapshots()
	if err != nil {
		fail(w, http.StatusInternalServerError, "服务器快照读取失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: items})
}

func (s *Server) handleDownloadSnapshot(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以下载服务器快照")
		return
	}
	name := r.PathValue("name")
	dir, err := s.store.SnapshotDir(name)
	if err != nil {
		fail(w, http.StatusNotFound, "这份快照不在回收站里")
		return
	}
	if _, err := os.Stat(dir); err != nil {
		fail(w, http.StatusNotFound, "这份快照不在回收站里")
		return
	}
	s.writeZipToResponse(w, r, sanitizeFilename(name)+".zip", func(out io.Writer) error {
		return zipDir(out, dir)
	})
}

// zipDir 把目录下的文件（不递归子目录）打包，供取回快照使用。
// 单个文件读失败就跳过，不因为一个坏文件让整包下载失败。
func zipDir(w io.Writer, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(w)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		info, err := file.Stat()
		if err != nil {
			file.Close()
			continue
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			file.Close()
			continue
		}
		header.Name = entry.Name()
		// 快照里可能有备份 zip：再压一遍几乎没有收益，直接存储省 CPU 和时间。
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".zip") {
			header.Method = zip.Store
		} else {
			header.Method = zip.Deflate
		}
		writer, err := zw.CreateHeader(header)
		if err != nil {
			file.Close()
			return err
		}
		if _, err := io.Copy(writer, file); err != nil {
			file.Close()
			return err
		}
		file.Close()
	}
	return zw.Close()
}
