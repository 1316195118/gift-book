package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const (
	guestInfoLimit    = 90
	guestInfoWindow   = time.Minute
	guestSubmitLimit  = 20
	guestSubmitWindow = time.Minute
	guestIPLimit      = 60
	guestIPWindow     = time.Minute
)

// guestRateLimiter 是公开宾客入口的进程内滑动窗口限流器。
// 它只阻止同一来源对同一登记的突发提交，不把正常的多人并发写请求串行化。
type guestRateLimiter struct {
	mu        sync.Mutex
	hits      map[string][]time.Time
	lastSweep time.Time
}

func newGuestRateLimiter() *guestRateLimiter {
	return &guestRateLimiter{
		hits:      make(map[string][]time.Time),
		lastSweep: time.Now(),
	}
}

// allow 记录一次请求；达到上限时返回预计可重试时间。
func (l *guestRateLimiter) allow(key string, limit int, window time.Duration) (bool, time.Duration) {
	if l == nil || limit <= 0 || window <= 0 {
		return true, 0
	}
	now := time.Now()
	cutoff := now.Add(-window)

	l.mu.Lock()
	defer l.mu.Unlock()

	recent := l.hits[key]
	first := 0
	for first < len(recent) && !recent[first].After(cutoff) {
		first++
	}
	if first > 0 {
		recent = append([]time.Time(nil), recent[first:]...)
	}
	if len(recent) >= limit {
		l.hits[key] = recent
		return false, time.Until(recent[0].Add(window))
	}

	l.hits[key] = append(recent, now)
	if now.Sub(l.lastSweep) >= 5*time.Minute {
		l.sweep(cutoff)
		l.lastSweep = now
	}
	return true, 0
}

// sweep 只在新请求到来时低频清理，避免后台协程常驻。
func (l *guestRateLimiter) sweep(cutoff time.Time) {
	for key, recent := range l.hits {
		if len(recent) == 0 || !recent[len(recent)-1].After(cutoff) {
			delete(l.hits, key)
		}
	}
}

func (s *Server) guestRateKey(r *http.Request, kind string) string {
	clientIP := s.guestClientIP(r)
	token := ""
	if r != nil {
		token = r.PathValue("token")
	}
	sum := sha256.Sum256([]byte(token))
	return kind + ":" + clientIP + ":" + hex.EncodeToString(sum[:12])
}

func (s *Server) guestIPRateKey(r *http.Request, kind string) string {
	return kind + ":" + s.guestClientIP(r)
}

func (s *Server) guestClientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if s.auth != nil {
		return s.auth.ClientIP(r)
	}
	return r.RemoteAddr
}

func writeGuestRateLimit(w http.ResponseWriter, retry time.Duration, message string) {
	seconds := int(retry.Seconds()) + 1
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	failCode(w, http.StatusTooManyRequests, "guest_rate_limited", message)
}
