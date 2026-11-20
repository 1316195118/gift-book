package api

import (
	"encoding/json"
	"net/http"
	"time"

	"giftbook/internal/update"
)

// handleUpdateCheck 检查是否有新版本。只读操作，任何已登录用户都能看，
// 但结果不含可写路径等敏感信息。
func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	mgr := s.updateManager()
	if mgr == nil {
		writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{"available": false, "reason": "unsupported"}})
		return
	}
	avail, err := mgr.Check()
	if err != nil {
		fail(w, http.StatusBadGateway, "检查更新失败："+err.Error())
		return
	}
	if avail == nil {
		writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{"available": false, "current": s.version}})
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"available": true,
		"version":   avail.Version,
		"tag":       avail.Tag,
		"digest":    avail.Digest,
		"size":      avail.Size,
		"current":   avail.Current,
		"arch":      avail.Arch,
		"canApply":  avail.CanApply,
	}})
}

// handleUpdateApply 安装更新：仅站点管理员可用。安装成功后延迟退出进程，
// 由容器 restart 策略拉起新二进制；非容器环境只落盘、不自动退出。
func (s *Server) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		failCode(w, http.StatusForbidden, "admin_required", "仅站点管理员可以更新程序")
		return
	}
	mgr := s.updateManager()
	if mgr == nil {
		fail(w, http.StatusNotImplemented, "当前环境不支持自更新")
		return
	}
	var body struct {
		Version string `json:"version"`
		Tag     string `json:"tag"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	// 重新检查一遍，防止客户端传一个旧的或伪造的版本号。
	avail, err := mgr.Check()
	if err != nil {
		fail(w, http.StatusBadGateway, "检查更新失败："+err.Error())
		return
	}
	if avail == nil {
		fail(w, http.StatusConflict, "已是最新版本")
		return
	}
	if body.Tag != "" && body.Tag != avail.Tag {
		fail(w, http.StatusBadRequest, "更新包与最新版本不一致，请刷新后重试")
		return
	}
	result, err := mgr.Apply(avail)
	if err != nil {
		s.audit(r, "更新程序失败", "", err.Error())
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.audit(r, "更新程序", "", result.Version)
	data := map[string]any{
		"version": result.Version,
		"path":    result.Path,
		"restart": s.autoRestart,
		"ok":      true,
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: data})
	if s.autoRestart {
		// 给响应留出 flush 的时间，再退出让容器重启。
		go func() {
			time.Sleep(600 * time.Millisecond)
			s.requestRestart()
		}()
	}
}

// handleUpdateStatus 返回当前版本与自动更新配置，供设置页展示。
func (s *Server) handleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	data := map[string]any{
		"version":     s.version,
		"build":       s.build,
		"autoRestart": s.autoRestart,
		"enabled":     s.updateManager() != nil,
	}
	if mgr := s.updateManager(); mgr != nil {
		data["target"] = mgr.TargetPath()
		data["proxy"] = mgr.Proxy()
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: data})
}

// handleUpdateSettings 读取当前代理设置（仅管理员）。
func (s *Server) handleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		failCode(w, http.StatusForbidden, "admin_required", "仅站点管理员可以修改更新设置")
		return
	}
	mgr := s.updateManager()
	if mgr == nil {
		fail(w, http.StatusNotImplemented, "当前环境不支持自更新")
		return
	}
	cfg, err := mgr.LoadConfig()
	if err != nil {
		fail(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"proxy": mgr.Proxy(),
		"auto":  cfg.Proxy,
	}})
}

// handleUpdateSettingsSave 保存代理设置并立即生效（仅管理员）。
func (s *Server) handleUpdateSettingsSave(w http.ResponseWriter, r *http.Request) {
	if !s.isSiteAdmin(r) {
		failCode(w, http.StatusForbidden, "admin_required", "仅站点管理员可以修改更新设置")
		return
	}
	mgr := s.updateManager()
	if mgr == nil {
		fail(w, http.StatusNotImplemented, "当前环境不支持自更新")
		return
	}
	var body struct {
		Proxy string `json:"proxy"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14)).Decode(&body); err != nil {
		fail(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if err := mgr.SaveConfig(update.Config{Proxy: body.Proxy}); err != nil {
		fail(w, http.StatusBadRequest, err.Error())
		return
	}
	s.audit(r, "修改更新代理", "", body.Proxy)
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{"proxy": mgr.Proxy()}})
}
