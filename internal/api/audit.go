package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// AuditEntry 是一条管理员/高危操作记录，只记动作与对象，不记密码和礼金内容。
type AuditEntry struct {
	At     string `json:"at"`
	Action string `json:"action"`
	Family string `json:"family,omitempty"`
	Detail string `json:"detail,omitempty"`
	IP     string `json:"ip,omitempty"`
}

const auditMaxBytes = 1 << 20
const auditKeepLines = 400

func (s *Server) auditPath() string {
	dir := s.configDir
	if dir == "" {
		dir = s.store.Dir()
	}
	return filepath.Join(dir, "audit.log")
}

// audit 追加一条操作记录；失败只打日志，不影响主流程。
func (s *Server) audit(r *http.Request, action, family, detail string) {
	entry := AuditEntry{
		At:     time.Now().Format("2006-01-02 15:04:05"),
		Action: action,
		Family: family,
		Detail: detail,
	}
	if r != nil {
		entry.IP = s.auth.ClientIP(r)
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return
	}
	s.auditMu.Lock()
	defer s.auditMu.Unlock()
	path := s.auditPath()
	_ = os.MkdirAll(filepath.Dir(path), 0o775)
	if info, statErr := os.Stat(path); statErr == nil && info.Size() > auditMaxBytes {
		s.trimAuditLocked(path)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.Write(append(raw, '\n'))
}

func (s *Server) trimAuditLocked(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	lines := make([]string, 0, auditKeepLines)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	file.Close()
	if len(lines) > auditKeepLines {
		lines = lines[len(lines)-auditKeepLines:]
	}
	_ = os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}

func (s *Server) handleListAudit(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		fail(w, http.StatusForbidden, "只有站点管理员可以查看操作记录")
		return
	}
	file, err := os.Open(s.auditPath())
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, response{Success: true, Data: []AuditEntry{}})
			return
		}
		fail(w, http.StatusInternalServerError, "操作记录读取失败")
		return
	}
	defer file.Close()
	// limit 默认 100，最多取到日志保留上限；action 做包含匹配，方便只看「还原」「删除」这类高危操作。
	limit := 100
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= auditKeepLines {
			limit = n
		}
	}
	action := strings.TrimSpace(r.URL.Query().Get("action"))
	entries := make([]AuditEntry, 0)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var entry AuditEntry
		if json.Unmarshal(scanner.Bytes(), &entry) != nil {
			continue
		}
		if action != "" && !strings.Contains(entry.Action, action) {
			continue
		}
		entries = append(entries, entry)
	}
	// 最新的在前。
	for left, right := 0, len(entries)-1; left < right; left, right = left+1, right-1 {
		entries[left], entries[right] = entries[right], entries[left]
	}
	if len(entries) > limit {
		entries = entries[:limit]
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: entries})
}
