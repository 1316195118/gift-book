package api

import (
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"giftbook/internal/auth"
	"giftbook/internal/store"
	"giftbook/internal/update"
)

// Server 汇总所有依赖。
type Server struct {
	store        *store.Store
	auth         *auth.Manager
	assets       fs.FS
	build        string
	version      string
	ocr          OCREngine
	configDir    string
	forceHTTPS   bool
	publicURL    string
	stream       *streamHub
	guestLimiter *guestRateLimiter

	auditMu       sync.Mutex
	backupMu      sync.Mutex
	lastBackupMu  sync.Mutex
	lastBackupAt  time.Time
	lastBackupErr string

	stopAutoBackup chan struct{}
	stopOnce       sync.Once
	autoBackupWG   sync.WaitGroup

	familySecretOnce     sync.Once
	familySecretKeyBytes []byte

	updater     *update.Manager
	autoRestart bool
	restartOnce sync.Once
	restartCh   chan struct{}
	updateJobMu sync.Mutex
	updateJob   *updateJob
}

// Options 是构造 Server 的参数。
type Options struct {
	Store     *store.Store
	Auth      *auth.Manager
	Assets    fs.FS
	Build     string
	Version   string
	OCR       OCREngine
	ConfigDir string
	// AutoRestart 表示更新完成后是否请求进程退出（容器里由 restart 策略拉起）。
	AutoRestart bool
	// ForceHTTPS 为 true 时把 HTTP 请求以 308 重定向到 HTTPS。
	// 仅在应用前面已有可信 HTTPS 终止层时开启，避免内网直连被锁在 HTTP 循环里。
	ForceHTTPS bool
	// PublicURL 是可选的外网根地址（如 https://giftbook.example.com）。
	// 配置后 robots.txt、sitemap.xml 与社交图片始终使用该地址。
	PublicURL string
}

// New 创建 HTTP 服务。
func New(opts Options) *Server {
	s := &Server{
		store:          opts.Store,
		auth:           opts.Auth,
		assets:         opts.Assets,
		build:          opts.Build,
		version:        opts.Version,
		ocr:            opts.OCR,
		configDir:      opts.ConfigDir,
		forceHTTPS:     opts.ForceHTTPS,
		publicURL:      normalizePublicURL(opts.PublicURL),
		stream:         newStreamHub(),
		guestLimiter:   newGuestRateLimiter(),
		stopAutoBackup: make(chan struct{}),
		restartCh:      make(chan struct{}),
		autoRestart:    opts.AutoRestart,
	}
	if opts.ConfigDir != "" {
		s.updater = update.New(opts.ConfigDir, opts.Version)
	}
	// 升级兼容：没有 families.json 时创建默认家庭，并把旧账簿归入默认家庭。
	s.initFamilies()
	return s
}

// Handler 返回完整路由。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/ping", s.handlePing)
	mux.HandleFunc("GET /api/build", s.handleBuild)
	mux.HandleFunc("GET /api/capabilities", s.handleCapabilities)
	mux.HandleFunc("GET /api/update/status", s.open(s.handleUpdateStatus))
	mux.HandleFunc("GET /api/update/check", s.open(s.handleUpdateCheck))
	mux.HandleFunc("POST /api/update/apply", s.open(s.handleUpdateApply))
	mux.HandleFunc("GET /api/update/progress", s.open(s.handleUpdateProgress))
	mux.HandleFunc("GET /api/update/settings", s.open(s.handleUpdateSettings))
	mux.HandleFunc("PUT /api/update/settings", s.open(s.handleUpdateSettingsSave))
	mux.HandleFunc("GET /api/health", s.open(s.handleHealth))
	mux.HandleFunc("GET /robots.txt", s.handleRobots)
	mux.HandleFunc("HEAD /robots.txt", s.handleRobots)
	mux.HandleFunc("GET /sitemap.xml", s.handleSitemap)
	mux.HandleFunc("HEAD /sitemap.xml", s.handleSitemap)
	mux.HandleFunc("GET /api/auth", s.handleAuthState)
	mux.HandleFunc("POST /api/auth", s.open(s.handleLogin))
	mux.HandleFunc("PUT /api/auth", s.open(s.handleUpdateAuth))
	mux.HandleFunc("DELETE /api/auth", s.open(s.handleLogout))

	mux.HandleFunc("GET /api/family/me", s.open(s.handleFamilyMe))
	mux.HandleFunc("POST /api/family/login", s.open(s.handleFamilyLogin))
	mux.HandleFunc("POST /api/family/logout", s.open(s.handleFamilyLogout))
	mux.HandleFunc("PUT /api/family/self", s.open(s.handleFamilySelfUpdate))
	mux.HandleFunc("GET /api/families", s.open(s.handleListFamilies))
	mux.HandleFunc("GET /api/families/activity", s.open(s.handleFamilyActivity))
	mux.HandleFunc("POST /api/families", s.open(s.handleCreateFamily))
	mux.HandleFunc("POST /api/families/import", s.open(s.handleImportFamilyBackup))
	mux.HandleFunc("GET /api/families/open", s.open(s.handleOpenFamilies))
	mux.HandleFunc("PUT /api/families/{id}", s.openID(s.handleUpdateFamily))
	mux.HandleFunc("DELETE /api/families/{id}", s.openID(s.handleDeleteFamily))
	mux.HandleFunc("POST /api/families/{id}/logout-all", s.openID(s.handleFamilyLogoutAll))
	mux.HandleFunc("GET /api/audit", s.open(s.handleListAudit))
	mux.HandleFunc("GET /api/family/archives", s.open(s.handleListFamilyArchives))
	mux.HandleFunc("POST /api/family/archives/restore/{name}", s.open(s.handleRestoreFamilyArchive))

	mux.HandleFunc("GET /api/events", s.open(s.handleListEvents))
	mux.HandleFunc("POST /api/events", s.open(s.handleCreateEvent))
	mux.HandleFunc("GET /api/events/{id}", s.openID(s.handleGetEvent))
	mux.HandleFunc("PUT /api/events/{id}", s.openID(s.handleUpdateEvent))
	mux.HandleFunc("POST /api/events/{id}/move", s.openID(s.handleMoveEvent))
	mux.HandleFunc("POST /api/events/{id}/guest", s.openID(s.handleGuestToggle))
	mux.HandleFunc("GET /api/events/{id}/guest/pending", s.openID(s.handleGuestPending))
	mux.HandleFunc("DELETE /api/events/{id}/guest/pending/{entry}", s.openID(s.handleGuestDismiss))
	mux.HandleFunc("GET /api/guest/{token}", s.open(s.handleGuestInfo))
	mux.HandleFunc("POST /api/guest/{token}/gifts", s.open(s.handleGuestSubmit))
	mux.HandleFunc("DELETE /api/events/{id}", s.openID(s.handleDeleteEvent))
	mux.HandleFunc("POST /api/events/{id}/verify", s.openID(s.handleVerifyEvent))
	mux.HandleFunc("GET /api/stream", s.open(s.handleStream))
	mux.HandleFunc("GET /api/family/backup", s.open(s.handleFamilyBackup))
	mux.HandleFunc("POST /api/family/backup/encrypted", s.open(s.handleEncryptedFamilyBackup))
	mux.HandleFunc("POST /api/family/backup/verify", s.open(s.handleVerifyFamilyBackup))
	mux.HandleFunc("POST /api/family/backup/restore", s.open(s.handleFamilyRestore))
	mux.HandleFunc("GET /api/family/auto-backups", s.open(s.handleFamilyAutoBackups))
	mux.HandleFunc("GET /api/family/auto-backups/{name}", s.open(s.handleFamilyAutoBackupDownload))
	mux.HandleFunc("POST /api/family/auto-backups/restore/{name}", s.open(s.handleFamilyAutoBackupRestore))
	mux.HandleFunc("GET /api/trash", s.open(s.handleListTrash))
	mux.HandleFunc("POST /api/trash/restore/{name}", s.open(s.handleRestoreTrash))
	mux.HandleFunc("GET /api/trash/snapshots", s.open(s.handleListSnapshots))
	mux.HandleFunc("GET /api/trash/snapshots/{name}", s.open(s.handleDownloadSnapshot))
	mux.HandleFunc("DELETE /api/trash/snapshots/{name}", s.open(s.handleDeleteSnapshot))

	mux.HandleFunc("GET /api/gifts", s.open(s.handleGetGifts))
	mux.HandleFunc("POST /api/gifts", s.open(s.handleCreateGift))
	mux.HandleFunc("PUT /api/gifts/{id}", s.openGiftID(s.handleUpdateGift))
	mux.HandleFunc("DELETE /api/gifts/{id}", s.openGiftID(s.handleDeleteGift))

	mux.HandleFunc("POST /api/ocr", s.open(s.handleOCR))

	mux.HandleFunc("GET /api/backup", s.open(s.handleBackup))
	mux.HandleFunc("GET /api/backup/info", s.open(s.handleBackupInfo))
	mux.HandleFunc("POST /api/backup/encrypted", s.open(s.handleEncryptedBackup))
	mux.HandleFunc("POST /api/backup/verify", s.open(s.handleVerifyBackup))
	mux.HandleFunc("POST /api/backup/restore", s.open(s.handleRestore))
	mux.HandleFunc("GET /api/events/{id}/export", s.openID(s.handleExportEvent))
	mux.HandleFunc("GET /api/autobackup", s.open(s.handleAutoBackupGet))
	mux.HandleFunc("PUT /api/autobackup", s.open(s.handleAutoBackupSave))
	mux.HandleFunc("POST /api/autobackup/run", s.open(s.handleAutoBackupRun))
	mux.HandleFunc("GET /api/autobackup/file/{name}", s.open(s.handleAutoBackupDownload))
	mux.HandleFunc("POST /api/autobackup/restore/{name}", s.open(s.handleAutoBackupRestore))
	mux.HandleFunc("DELETE /api/autobackup/file/{name}", s.open(s.handleAutoBackupDelete))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "接口不存在")
	})
	mux.Handle("/", s.staticHandler())

	// 写请求统一在路由入口处校验同源，避免新增接口漏挂站点级检查。
	return s.securityHeaders(s.sameOriginWrites(s.httpsRedirect(mux)))
}

func (s *Server) sameOriginWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.sameOrigin(r) {
			fail(w, http.StatusForbidden, "跨站请求已被拒绝")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// middle 是 API 通用前置检查：同源 + 访问保护。
func (s *Server) middle(w http.ResponseWriter, r *http.Request) bool {
	if !s.sameOrigin(r) {
		fail(w, http.StatusForbidden, "跨站请求已被拒绝")
		return false
	}
	if !s.auth.Check(r) {
		fail(w, http.StatusUnauthorized, "未登录或登录已过期")
		return false
	}
	return true
}

func (s *Server) protected(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.middle(w, r) {
			return
		}
		next(w, r)
	}
}

// open 只做同源检查，不做站点登录校验：
// 家庭门与家庭内的账簿接口要允许「只知道家庭访问码」的成员使用，
// 管理员密码只作为管理员入口，不再拦普通家庭。
func (s *Server) open(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.sameOrigin(r) {
			fail(w, http.StatusForbidden, "跨站请求已被拒绝")
			return
		}
		next(w, r)
	}
}

func (s *Server) openID(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.sameOrigin(r) {
			fail(w, http.StatusForbidden, "跨站请求已被拒绝")
			return
		}
		id := r.PathValue("id")
		if !eventIDPattern.MatchString(id) {
			fail(w, http.StatusBadRequest, "无效的事件ID")
			return
		}
		next(w, r, id)
	}
}

func (s *Server) openGiftID(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.sameOrigin(r) {
			fail(w, http.StatusForbidden, "跨站请求已被拒绝")
			return
		}
		id := r.PathValue("id")
		if !eventIDPattern.MatchString(id) {
			fail(w, http.StatusBadRequest, "无效的礼物ID")
			return
		}
		next(w, r, id)
	}
}

func (s *Server) protectedID(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.middle(w, r) {
			return
		}
		id := r.PathValue("id")
		if !eventIDPattern.MatchString(id) {
			fail(w, http.StatusBadRequest, "无效的事件ID")
			return
		}
		next(w, r, id)
	}
}

func (s *Server) protectedGiftID(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.middle(w, r) {
			return
		}
		id := r.PathValue("id")
		if !eventIDPattern.MatchString(id) {
			fail(w, http.StatusBadRequest, "无效的礼物ID")
			return
		}
		next(w, r, id)
	}
}

func (s *Server) handleBuild(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]string{
		"build":   s.build,
		"version": s.version,
	}})
}

// handleHealth 给已登录用户看的服务概况：版本、OCR、最近备份、当前家庭数据量。
// 不含姓名与金额，也不泄露其他家庭的信息；公开探针仍走 /api/build。
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	family, ok := s.resolveFamily(r)
	if !ok {
		failCode(w, http.StatusUnauthorized, "family_required", "请选择家庭并输入访问码")
		return
	}
	events, _ := s.store.ReadEvents()
	eventCount, giftCount := 0, 0
	ids := make([]string, 0, len(events))
	for id, event := range events {
		if !eventBelongsTo(event, family.ID) {
			continue
		}
		eventCount++
		ids = append(ids, id)
	}
	if counts := s.store.CountGiftsMany(ids); len(counts) > 0 {
		for _, count := range counts {
			giftCount += count
		}
	}
	s.lastBackupMu.Lock()
	lastAt := s.lastBackupAt
	lastErr := s.lastBackupErr
	s.lastBackupMu.Unlock()
	data := map[string]any{
		"build":               s.build,
		"version":             s.version,
		"ocr":                 s.ocr.Enabled(),
		"events":              eventCount,
		"gifts":               giftCount,
		"realtimeConnections": s.stream.count(),
		"lastBackup":          "",
		"backupError":         lastErr,
	}
	if !lastAt.IsZero() {
		data["lastBackup"] = lastAt.Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, response{Success: true, Data: data})
}

// handleCapabilities 报告服务端能力，供前端按需启用入口（例如 OCR）。
func (s *Server) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response{Success: true, Data: map[string]any{
		"build":   s.build,
		"version": s.version,
		"ocr":     s.ocr.Enabled(),
	}})
}

func (s *Server) buildLabel() string { return s.build }

func (s *Server) updateManager() *update.Manager { return s.updater }

// RestartChannel 返回一个在更新完成被触发时关闭的通道，供 main 做优雅退出。
func (s *Server) RestartChannel() <-chan struct{} { return s.restartCh }

func (s *Server) requestRestart() {
	s.restartOnce.Do(func() { close(s.restartCh) })
}

// IsAutoRestart 供状态展示。
func (s *Server) IsAutoRestart() bool { return s.autoRestart }

// 内容安全策略：脚本只允许同源构建产物；样式保留 inline（骨架屏与动态条形宽度）；
// 图片允许 data:/blob:（封面、二维码、PDF 栅格化），媒体与 Worker 允许 blob:。
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

// securityHeaders 统一加基础安全头；静态资源另外处理缓存。
func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
		if s.isHTTPS(r) {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
			if r.URL.Path != "/api/stream" && strings.Contains(strings.ToLower(r.Header.Get("Accept-Encoding")), "gzip") {
				w = jsonCompressionWriter{ResponseWriter: w}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) httpsRedirect(next http.Handler) http.Handler {
	if !s.forceHTTPS {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.isHTTPS(r) || r.Host == "" || (r.URL.Path == "/api/ping" && isLoopbackRequest(r)) {
			next.ServeHTTP(w, r)
			return
		}
		target := "https://" + r.Host + r.URL.RequestURI()
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
	})
}

func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func (s *Server) isHTTPS(r *http.Request) bool {
	return s.auth != nil && s.auth.IsHTTPS(r)
}

func (s *Server) siteOrigin(r *http.Request) string {
	if s.publicURL != "" {
		return s.publicURL
	}
	host := strings.TrimSpace(r.Host)
	if !validRequestHost(host) {
		return ""
	}
	scheme := "http"
	if s.isHTTPS(r) {
		scheme = "https"
	}
	return scheme + "://" + host
}

func normalizePublicURL(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.User != nil || parsed.Host == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func validRequestHost(host string) bool {
	if host == "" || strings.ContainsAny(host, "/\\?#@ \t\r\n") {
		return false
	}
	parsed, err := url.Parse("http://" + host)
	return err == nil && parsed.User == nil && parsed.Host == host && parsed.Path == ""
}
