package api

import (
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"giftbook/internal/auth"
	"giftbook/internal/store"
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
	strictOrigin bool
	stream       *streamHub

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
	// StrictOrigin 为 true 时，写请求要求 Origin 的 host:port 与 Host 完全一致。
	// 默认只比主机名，保持与旧版（含开发代理、同机不同端口前端）的兼容。
	StrictOrigin bool
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
		strictOrigin:   opts.StrictOrigin,
		stream:         newStreamHub(),
		stopAutoBackup: make(chan struct{}),
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
	mux.HandleFunc("GET /api/auth", s.handleAuthState)
	mux.HandleFunc("POST /api/auth", s.handleLogin)
	mux.HandleFunc("PUT /api/auth", s.handleUpdateAuth)
	mux.HandleFunc("DELETE /api/auth", s.handleLogout)

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

	return s.securityHeaders(mux)
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
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}
