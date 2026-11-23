package api

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"html"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
)

type staticAsset struct {
	data         []byte
	contentType  string
	cacheControl string
	gzipped      []byte
}

var (
	htmlTitlePattern = regexp.MustCompile(`<title>[^<]*</title>`)
	htmlMetaPattern  = func(attr, name string) *regexp.Regexp {
		return regexp.MustCompile(`<meta ` + attr + `="` + regexp.QuoteMeta(name) + `" content="[^"]*"\s*/?>`)
	}
)

type staticPageMeta struct {
	title       string
	description string
}

var publicPageMeta = map[string]staticPageMeta{
	"/terms": {
		title:       "服务条款｜电子礼簿账户规范、内容权利与免责声明说明",
		description: "了解电子礼簿的服务范围、账户与访问凭证要求、使用规范、用户内容、数据备份、免责声明与争议处理方式，帮助家庭成员安心使用和协作，共同维护可靠的协作环境。",
	},
	"/privacy": {
		title:       "隐私政策｜电子礼簿数据收集、加密保存与完整删除说明",
		description: "了解电子礼簿收集哪些必要信息、礼金数据如何加密保存、日志和备份保留多久，以及你如何访问、更正、导出或删除数据，隐私边界清晰透明，帮助主家与宾客都能明白数据去向。",
	},
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
		status := http.StatusOK
		// 公开静态路由：未加哈希的 Vue 视图由同一 index 承载。
		if clean == "terms" || clean == "privacy" {
			clean = "index.html"
		}
		if isDirectory(s.assets, clean) || !exists(s.assets, clean) {
			// 资源文件不存在时不能伪装成页面；未知页面则统一返回品牌 404。
			if strings.HasPrefix(r.URL.Path, "/assets/") || path.Ext(clean) != "" {
				http.NotFound(w, r)
				return
			}
			clean = "404.html"
			status = http.StatusNotFound
		}
		asset, err := loadStaticAsset(s.assets, clean, cache)
		if err != nil {
			fail(w, http.StatusNotFound, "文件不存在")
			return
		}

		data := asset.data
		personalized := false
		if clean == "index.html" && status == http.StatusOK {
			data = s.personalizeIndex(data, r)
			personalized = !bytes.Equal(data, asset.data)
		}
		w.Header().Set("Content-Type", asset.contentType)
		w.Header().Set("Cache-Control", asset.cacheControl)
		// 响应体会随 Accept-Encoding 变化，因此无论本次是否真的压缩，都要声明 Vary，
		// 否则共享缓存可能把 gzip 版本发给未声明 gzip 的客户端。
		if asset.gzipped != nil || (compressible(asset.contentType) && len(data) >= 1024) {
			w.Header().Set("Vary", "Accept-Encoding")
		}
		// 文本类资源按 Accept-Encoding 返回首次请求时缓存的 gzip 结果。
		gzipResponse := false
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			if personalized {
				if compressed := gzipPayload(data); compressed != nil {
					data = compressed
					gzipResponse = true
				}
			} else if asset.gzipped != nil {
				data = asset.gzipped
				gzipResponse = true
			}
		}
		if gzipResponse {
			w.Header().Set("Content-Encoding", "gzip")
		}
		w.Header().Set("Content-Length", itoa(len(data)))
		w.WriteHeader(status)
		if r.Method != http.MethodHead {
			_, _ = w.Write(data)
		}
	})
}

// personalizeIndex 为社交爬虫补上绝对图片与规范链接。
// 前端路由元信息仍由 page-meta.js 在运行时更新；这里保证不执行 JS 的抓取器
// 也能拿到当前主机上的 og:image 和 og:url。
func (s *Server) personalizeIndex(data []byte, r *http.Request) []byte {
	origin := s.siteOrigin(r)
	if origin == "" {
		return data
	}
	if meta, ok := publicPageMeta[r.URL.Path]; ok {
		title := html.EscapeString(meta.title)
		description := html.EscapeString(meta.description)
		data = replaceFirst(data, htmlTitlePattern, "<title>"+title+"</title>")
		data = replaceFirst(data, htmlMetaPattern("name", "description"), `<meta name="description" content="`+description+`">`)
		data = replaceFirst(data, htmlMetaPattern("property", "og:title"), `<meta property="og:title" content="`+title+`">`)
		data = replaceFirst(data, htmlMetaPattern("property", "og:description"), `<meta property="og:description" content="`+description+`">`)
		data = replaceFirst(data, htmlMetaPattern("name", "twitter:title"), `<meta name="twitter:title" content="`+title+`">`)
		data = replaceFirst(data, htmlMetaPattern("name", "twitter:description"), `<meta name="twitter:description" content="`+description+`">`)
	}
	image := origin + "/og-cover.png"
	data = replaceFirst(data, htmlMetaPattern("property", "og:image"), `<meta property="og:image" content="`+image+`">`)
	data = replaceFirst(data, htmlMetaPattern("name", "twitter:image"), `<meta name="twitter:image" content="`+image+`">`)
	if bytes.Contains(data, []byte(`rel="canonical"`)) {
		return data
	}
	pagePath := r.URL.Path
	if pagePath == "" || pagePath == "/index.html" {
		pagePath = "/"
	}
	escapedOrigin := html.EscapeString(origin)
	escapedPage := html.EscapeString(escapedOrigin + pagePath)
	insert := []byte(fmt.Sprintf(
		`<link rel="canonical" href="%s"><meta property="og:url" content="%s">`,
		escapedPage, escapedPage,
	))
	return bytes.Replace(data, []byte("</head>"), append(insert, []byte("</head>")...), 1)
}

func replaceFirst(data []byte, pattern *regexp.Regexp, replacement string) []byte {
	loc := pattern.FindIndex(data)
	if loc == nil {
		return data
	}
	out := make([]byte, 0, len(data)-loc[1]+loc[0]+len(replacement))
	out = append(out, data[:loc[0]]...)
	out = append(out, replacement...)
	out = append(out, data[loc[1]:]...)
	return out
}

func gzipPayload(data []byte) []byte {
	if len(data) < 1024 {
		return nil
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(data); err != nil {
		return nil
	}
	if err := zw.Close(); err != nil || buf.Len() >= len(data) {
		return nil
	}
	return buf.Bytes()
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
	if compressible(asset.contentType) {
		asset.gzipped = gzipPayload(data)
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
