package api

import (
	"bytes"
	"compress/gzip"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"
)

type staticAsset struct {
	data         []byte
	contentType  string
	cacheControl string
	gzipped      []byte
}

// staticHandler 提供内嵌的 Vue 3 前端产物（webapp/dist，由 Vite 构建）。
// 页面由前端按状态切换，URL 不变；未命中的静态路径回退到 index.html。
func (s *Server) staticHandler() http.Handler {
	// 内嵌前端在一次进程生命周期内不会变化。缓存原文件和压缩结果，
	// 避免 NAS 每次刷新都重复读 embed FS、分配大块内存并现场 gzip。
	cache := &sync.Map{}
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
		asset, err := loadStaticAsset(s.assets, clean, cache)
		if err != nil {
			fail(w, http.StatusNotFound, "文件不存在")
			return
		}

		data := asset.data
		w.Header().Set("Content-Type", asset.contentType)
		w.Header().Set("Cache-Control", asset.cacheControl)
		// 响应体会随 Accept-Encoding 变化，因此无论本次是否真的压缩，都要声明 Vary，
		// 否则共享缓存可能把 gzip 版本发给未声明 gzip 的客户端。
		if asset.gzipped != nil || (compressible(asset.contentType) && len(data) >= 1024) {
			w.Header().Set("Vary", "Accept-Encoding")
		}
		// 文本类资源按 Accept-Encoding 返回首次请求时缓存的 gzip 结果。
		if asset.gzipped != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			data = asset.gzipped
			w.Header().Set("Content-Encoding", "gzip")
		}
		w.Header().Set("Content-Length", itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		if r.Method != http.MethodHead {
			_, _ = w.Write(data)
		}
	})
}

func loadStaticAsset(fsys fs.FS, name string, cache *sync.Map) (*staticAsset, error) {
	if hit, ok := cache.Load(name); ok {
		return hit.(*staticAsset), nil
	}
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return nil, err
	}
	asset := &staticAsset{
		data:        data,
		contentType: mime.TypeByExtension(path.Ext(name)),
	}
	if path.Ext(name) == ".webmanifest" {
		asset.contentType = "application/manifest+json"
	}
	if asset.contentType == "" {
		asset.contentType = "application/octet-stream"
	}
	if strings.HasPrefix(name, "assets/") {
		// 构建产物文件名带哈希，可以长期缓存。
		asset.cacheControl = "public, max-age=31536000, immutable"
	} else {
		asset.cacheControl = "no-cache, no-store, must-revalidate"
	}
	// 只预压缩可压缩文本；如果压缩反而更大就保留 nil，运行时回退原文件。
	if compressible(asset.contentType) && len(data) >= 1024 {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		_, writeErr := zw.Write(data)
		closeErr := zw.Close()
		if writeErr == nil && closeErr == nil && buf.Len() < len(data) {
			asset.gzipped = buf.Bytes()
		}
	}
	actual, _ := cache.LoadOrStore(name, asset)
	return actual.(*staticAsset), nil
}

func exists(fsys fs.FS, name string) bool {
	_, err := fs.Stat(fsys, name)
	return err == nil
}

func isDirectory(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && info.IsDir()
}

// compressible 只挑可压缩的文本资源，避免对图片/字体做无意义 CPU 消耗。
func compressible(ctype string) bool {
	return strings.HasPrefix(ctype, "text/") ||
		strings.Contains(ctype, "javascript") ||
		strings.Contains(ctype, "json") ||
		strings.Contains(ctype, "xml") ||
		strings.Contains(ctype, "svg")
}
