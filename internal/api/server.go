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

	backupMu      sync.Mutex
	lastBackupMu  sync.Mutex
	lastBackupAt  time.Time
	lastBackupErr string

	stopAutoBackup chan struct{}
	stopOnce       sync.Once
	autoBackupWG   sync.WaitGroup
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
	return &Server{
		store:          opts.Store,
		auth:           opts.Auth,
		assets:         opts.Assets,
		build:          opts.Build,
		version:        opts.Version,
		ocr:            opts.OCR,
		configDir:      opts.ConfigDir,
		strictOrigin:   opts.StrictOrigin,
		stopAutoBackup: make(chan struct{}),
	}
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

	mux.HandleFunc("GET /api/events", s.protected(s.handleListEvents))
	mux.HandleFunc("POST /api/events", s.protected(s.handleCreateEvent))
	mux.HandleFunc("GET /api/events/{id}", s.protectedID(s.handleGetEvent))
	mux.HandleFunc("PUT /api/events/{id}", s.protectedID(s.handleUpdateEvent))
	mux.HandleFunc("DELETE /api/events/{id}", s.protectedID(s.handleDeleteEvent))
	mux.HandleFunc("POST /api/events/{id}/verify", s.protectedID(s.handleVerifyEvent))

	mux.HandleFunc("GET /api/gifts", s.protected(s.handleGetGifts))
	mux.HandleFunc("POST /api/gifts", s.protected(s.handleCreateGift))
	mux.HandleFunc("PUT /api/gifts/{id}", s.protectedGiftID(s.handleUpdateGift))
	mux.HandleFunc("DELETE /api/gifts/{id}", s.protectedGiftID(s.handleDeleteGift))

	mux.HandleFunc("POST /api/ocr", s.protected(s.handleOCR))

	mux.HandleFunc("GET /api/backup", s.protected(s.handleBackup))
	mux.HandleFunc("GET /api/backup/info", s.protected(s.handleBackupInfo))
	mux.HandleFunc("POST /api/backup/restore", s.protected(s.handleRestore))
	mux.HandleFunc("GET /api/events/{id}/export", s.protectedID(s.handleExportEvent))
	mux.HandleFunc("GET /api/autobackup", s.protected(s.handleAutoBackupGet))
	mux.HandleFunc("PUT /api/autobackup", s.protected(s.handleAutoBackupSave))
	mux.HandleFunc("POST /api/autobackup/run", s.protected(s.handleAutoBackupRun))
	mux.HandleFunc("GET /api/autobackup/file/{name}", s.protected(s.handleAutoBackupDownload))
	mux.HandleFunc("POST /api/autobackup/restore/{name}", s.protected(s.handleAutoBackupRestore))
	mux.HandleFunc("DELETE /api/autobackup/file/{name}", s.protected(s.handleAutoBackupDelete))

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

// securityHeaders 统一加基础安全头；静态资源另外处理缓存。
func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}
