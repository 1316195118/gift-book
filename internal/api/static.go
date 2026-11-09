package api

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// staticHandler 提供内嵌的 Vue 3 前端产物（webapp/dist，由 Vite 构建）。
// 页面由前端按状态切换，URL 不变；未命中的静态路径回退到 index.html。
func (s *Server) staticHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if clean == "" || clean == "." {
			clean = "index.html"
		}
		if isDirectory(s.assets, clean) || !exists(s.assets, clean) {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				http.NotFound(w, r)
				return
			}
			clean = "index.html"
		}
		data, err := fs.ReadFile(s.assets, clean)
		if err != nil {
			fail(w, http.StatusNotFound, "文件不存在")
			return
		}

		ctype := mime.TypeByExtension(path.Ext(clean))
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ctype)
		if strings.HasPrefix(clean, "assets/") {
			// 构建产物文件名带哈希，可以长期缓存。
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		w.Header().Set("Content-Length", itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		if r.Method != http.MethodHead {
			_, _ = w.Write(data)
		}
	})
}

func exists(fsys fs.FS, name string) bool {
	_, err := fs.Stat(fsys, name)
	return err == nil
}

func isDirectory(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && info.IsDir()
}
