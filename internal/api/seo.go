package api

import (
	"fmt"
	"net/http"
	"strings"
)

func (s *Server) handleRobots(w http.ResponseWriter, r *http.Request) {
	origin := s.siteOrigin(r)
	lines := []string{
		"User-agent: *",
		"Allow: /",
		"Disallow: /api/",
		"Disallow: /?gift=",
	}
	if origin != "" {
		lines = append(lines, "Sitemap: "+origin+"/sitemap.xml")
	}
	writeSEO(w, r, "text/plain; charset=utf-8", strings.Join(lines, "\n")+"\n")
}

func (s *Server) handleSitemap(w http.ResponseWriter, r *http.Request) {
	origin := s.siteOrigin(r)
	if origin == "" {
		fail(w, http.StatusNotFound, "无法确定站点地址")
		return
	}
	body := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>%s/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>%s/privacy</loc><changefreq>yearly</changefreq><priority>0.4</priority></url>
  <url><loc>%s/terms</loc><changefreq>yearly</changefreq><priority>0.4</priority></url>
</urlset>
`, origin, origin, origin)
	writeSEO(w, r, "application/xml; charset=utf-8", body)
}

func writeSEO(w http.ResponseWriter, r *http.Request, contentType, body string) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodHead {
		_, _ = w.Write([]byte(body))
	}
}
