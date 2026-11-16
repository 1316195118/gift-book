package api

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"giftbook/internal/store"
)

// ---- GET /api/family/archives（站点管理员） ----

func (s *Server) handleListFamilyArchives(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以管理家庭归档")
		return
	}
	items, err := s.store.ListFamilyArchives()
	if err != nil {
		fail(w, http.StatusInternalServerError, "家庭归档读取失败")
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: items})
}

// ---- POST /api/family/archives/restore/{name}（站点管理员） ----

func (s *Server) handleRestoreFamilyArchive(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以恢复家庭归档")
		return
	}
	name := r.PathValue("name")
	dir, err := s.store.FamilyArchiveDir(name)
	if err != nil {
		fail(w, http.StatusNotFound, "这份家庭归档不在回收站里")
		return
	}
	// 归档里可能带着该家庭的自动备份：RestoreFamilyArchive 成功后会把归档目录整个删掉，
	// 先搬到备份根目录的临时位置，等拿到新家庭 ID 再挂过去。
	staged := ""
	archiveBackups := filepath.Join(dir, "family-backups")
	if _, statErr := os.Stat(archiveBackups); statErr == nil {
		candidate := filepath.Join(s.familyBackupsDir(), ".restoring-"+randomFamilyHex(4))
		if moveErr := moveAutoBackups(archiveBackups, candidate); moveErr != nil {
			// 取不出来就不能继续：恢复成功会删掉归档目录，备份会被一起带走。
			log.Printf("归档里的家庭备份暂存失败: %v", moveErr)
			fail(w, http.StatusInternalServerError, "归档里的家庭备份无法取出，请检查 .trash 目录权限后重试")
			return
		}
		staged = candidate
	}
	archive, err := s.store.RestoreFamilyArchive(name)
	if err != nil {
		// 恢复失败时把备份放回归档，下次重试还能一起带走。
		if staged != "" {
			_ = moveAutoBackups(staged, archiveBackups)
		}
		if errors.Is(err, store.ErrNotFound) {
			fail(w, http.StatusNotFound, "这份家庭归档不在回收站里")
			return
		}
		fail(w, http.StatusBadRequest, "恢复失败："+err.Error())
		return
	}
	if staged != "" {
		if err := moveAutoBackups(staged, filepath.Join(s.familyBackupsDir(), archive.FamilyID)); err != nil {
			log.Printf("家庭备份未能挂到新家庭 %s: %v", archive.FamilyID, err)
		}
	}
	s.audit(r, "恢复家庭归档", archive.FamilyName, "新家庭 "+archive.FamilyID)
	writeJSON(w, http.StatusOK, response{Success: true, Data: archive})
}
