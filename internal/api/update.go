package api

import (
	"encoding/json"
	"net/http"
	"net/url"

	"giftbook/internal/update"
)

// handleUpdateCheck 检查是否有新版本。只读操作，任何已登录用户都能看，
// 但结果不含可写路径等敏感信息。
func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	// 检查接口只读且首页可见，但会请求 GHCR，按 IP 限流防止公开访客刷爆。
	if ok, retry := s.guestLimiter.allow(s.guestIPRateKey(r, "update-check-ip"), guestInfoLimit, guestInfoIPWindow); !ok {
		writeGuestRateLimit(w, retry, "检查更新太频繁，请稍后再试")
		return
	}
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

// handleUpdateApply 启动后台安装任务，仅站点管理员可用。
// 下载可能持续几十秒，接口立即返回 202，由 /api/update/progress 提供阶段与字节进度。
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
	if body.Tag == "" || !mgr.AllowedTag(body.Tag) {
		fail(w, http.StatusBadRequest, "更新包标签不合法")
		return
	}
	job, started := s.beginUpdateJob(body.Version, body.Tag)
	if !started {
		writeJSON(w, http.StatusConflict, response{
			Success: false,
			Message: "已有更新正在进行",
			Data:    job,
		})
		return
	}
	s.audit(r, "开始更新程序", "", body.Tag)
	go s.runUpdateJob(job.ID, mgr, body.Tag)
	writeJSON(w, http.StatusAccepted, response{Success: true, Data: job})
}

// handleUpdateProgress 返回当前安装任务；无任务或服务刚重启时返回 idle。
func (s *Server) handleUpdateProgress(w http.ResponseWriter, r *http.Request) {
	job := s.currentUpdateJob()
	if job == nil {
		job = &updateJob{State: "idle", Current: s.version}
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: job})
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
		data["proxy"] = maskProxy(mgr.Proxy())
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
		"proxy": maskProxy(mgr.Proxy()),
		"auto":  maskProxy(cfg.Proxy),
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

// maskProxy 对代理地址里的凭据脱敏，避免 status 接口泄露 user:pass。
func maskProxy(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		return raw
	}
	user := u.User.Username()
	_, hasPassword := u.User.Password()
	// 直接拼字符串，避免 url.URL.String 把 * 编码成 %2A。
	scheme := u.Scheme + "://"
	host := u.Host
	tail := u.Path
	if u.RawQuery != "" {
		tail += "?" + u.RawQuery
	}
	if hasPassword {
		return scheme + user + ":" + "****" + "@" + host + tail
	}
	return scheme + user + "@" + host + tail
}
