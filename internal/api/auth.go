package api

import (
	"errors"
	"net/http"
	"time"

	"giftbook/internal/auth"
)

// ---- GET /api/auth ----

func (s *Server) handleAuthState(w http.ResponseWriter, r *http.Request) {
	enabled := s.auth.Enabled()
	authenticated := s.auth.Check(r)
	writeJSON(w, http.StatusOK, response{
		Success:       true,
		Enabled:       &enabled,
		Authenticated: &authenticated,
	})
}

// ---- POST /api/auth 登录 ----

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Enabled() {
		enabled, authenticated := false, true
		writeJSON(w, http.StatusOK, response{Success: true, Enabled: &enabled, Authenticated: &authenticated})
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	ok, fails, retry := s.auth.VerifyOrFail(r, body.Password)
	if !ok {
		time.Sleep(400 * time.Millisecond)
		if retry > 0 {
			w.Header().Set("Retry-After", itoa(int(retry.Seconds())+1))
			minutes := int(retry.Minutes()) + 1
			fail(w, http.StatusTooManyRequests, "尝试次数过多，请 "+itoa(minutes)+" 分钟后再试")
			return
		}
		left := 5 - fails
		if left < 1 {
			left = 1
		}
		fail(w, http.StatusUnauthorized, "访问密码不正确，还可尝试 "+itoa(left)+" 次")
		return
	}
	s.auth.SetCookie(w, r)
	enabled, authenticated := true, true
	writeJSON(w, http.StatusOK, response{Success: true, Enabled: &enabled, Authenticated: &authenticated})
}

// ---- PUT /api/auth 修改访问保护 ----

func (s *Server) handleUpdateAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled         *bool  `json:"enabled"`
		Password        string `json:"password"`
		CurrentPassword string `json:"currentPassword"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Enabled == nil {
		fail(w, http.StatusBadRequest, "无效的请求数据")
		return
	}
	if s.auth.Unreadable() {
		fail(w, http.StatusServiceUnavailable, "访问保护状态文件无法读取，请先检查配置目录权限")
		return
	}
	// 已开启时，关闭或修改密码都要先验证当前密码，并计入防爆破。
	if s.auth.Enabled() && !s.auth.Check(r) && *body.Enabled {
		ok, fails, retry := s.auth.VerifyOrFail(r, body.CurrentPassword)
		if !ok {
			if retry > 0 {
				minutes := int(retry.Minutes()) + 1
				fail(w, http.StatusTooManyRequests, "尝试次数过多，请 "+itoa(minutes)+" 分钟后再试")
				return
			}
			left := 5 - fails
			if left < 1 {
				left = 1
			}
			fail(w, http.StatusUnauthorized, "当前访问密码不正确，还可尝试 "+itoa(left)+" 次")
			return
		}
	}
	updating := auth.UpdateRequest{Enabled: *body.Enabled, Password: body.Password, CurrentPassword: body.CurrentPassword}
	if !*body.Enabled && s.auth.Enabled() {
		ok, _, _ := s.auth.VerifyOrFail(r, body.CurrentPassword)
		if !ok {
			fail(w, http.StatusUnauthorized, "当前访问密码不正确")
			return
		}
	}
	if err := s.auth.Update(r, updating); err != nil {
		switch {
		case errors.Is(err, auth.ErrTooWeak):
			fail(w, http.StatusBadRequest, "访问密码至少 8 位")
		case errors.Is(err, auth.ErrWrongPassword):
			fail(w, http.StatusUnauthorized, "当前访问密码不正确")
		default:
			fail(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	if *body.Enabled {
		s.auth.SetCookie(w, r)
	} else {
		s.auth.ClearCookie(w, r)
	}
	enabled := *body.Enabled
	writeJSON(w, http.StatusOK, response{Success: true, Enabled: &enabled})
}

// ---- DELETE /api/auth 退出登录 ----

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.auth.ClearCookie(w, r)
	writeJSON(w, http.StatusOK, response{Success: true})
}

// ---- GET /api/ping ----

func (s *Server) handlePing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"success":true,"pong":true}`))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	negative := n < 0
	if negative {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
