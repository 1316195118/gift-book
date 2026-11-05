package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// OCREngine 描述本地 OCR 的调用配置。命令行接口与旧版 ocr/recognize.py 一致：
// 传入图片路径，向 stdout 输出 {"success":true,"data":{"lines":[...]}}。
type OCREngine struct {
	Python string // venv 里的 python 解释器
	Script string // recognize.py 路径
	Root   string // 工作目录
}

// Enabled 报告 OCR 是否可用。
func (e OCREngine) Enabled() bool {
	if e.Python == "" || e.Script == "" {
		return false
	}
	if _, err := os.Stat(e.Python); err != nil {
		return false
	}
	if _, err := os.Stat(e.Script); err != nil {
		return false
	}
	return true
}

var ocrMu sync.Mutex

func (s *Server) handleOCR(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-GiftBook-OCR") != "1" {
		fail(w, http.StatusForbidden, "无效的识别请求。")
		return
	}
	if !s.ocr.Enabled() {
		fail(w, http.StatusServiceUnavailable,
			"当前部署未内置 OCR。请使用完整镜像，或在设置里指定 OCR 程序路径。")
		return
	}
	if r.ContentLength > 8<<20 {
		fail(w, http.StatusRequestEntityTooLarge, "每张图片不能超过 8MB。")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	file, header, err := r.FormFile("image")
	if err != nil {
		fail(w, http.StatusBadRequest, "图片上传失败，请使用 JPG、PNG 或 WebP 图片。")
		return
	}
	defer file.Close()
	buf, err := io.ReadAll(file)
	if err != nil || len(buf) == 0 {
		fail(w, http.StatusBadRequest, "图片上传失败，请重新选择。")
		return
	}
	mimeType := http.DetectContentType(buf)
	switch mimeType {
	case "image/jpeg", "image/png", "image/webp":
	default:
		fail(w, http.StatusUnsupportedMediaType,
			"仅支持有效的 JPG、PNG、WebP 图片，不接受 PDF、SVG 或其他文件。")
		return
	}

	// 单进程串行，避免同时识别把内存放大。
	if !ocrMu.TryLock() {
		w.Header().Set("Retry-After", "5")
		fail(w, http.StatusTooManyRequests, "正在处理另一张礼簿，请稍后重试。")
		return
	}
	defer ocrMu.Unlock()

	dir, err := os.MkdirTemp("", "giftbook-ocr-*")
	if err != nil {
		fail(w, http.StatusInternalServerError, "无法创建临时目录。")
		return
	}
	defer os.RemoveAll(dir)
	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".jpg"
	}
	imgPath := filepath.Join(dir, "upload"+ext)
	if err := os.WriteFile(imgPath, buf, 0o600); err != nil {
		fail(w, http.StatusInternalServerError, "无法写入临时图片。")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.ocr.Python, s.ocr.Script, imgPath)
	cmd.Dir = s.ocr.Root
	var stdout bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &stdout, limit: 2 << 20}
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			fail(w, http.StatusGatewayTimeout, "识别超时，请裁剪为单页、缩小图片后重试。")
			return
		}
		fail(w, http.StatusServiceUnavailable, "本地识别失败，请重新拍摄清晰的单页图片后重试。")
		return
	}
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Lines []any `json:"lines"`
		} `json:"data"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil || !result.Success {
		fail(w, http.StatusServiceUnavailable, "本地识别失败，请重新拍摄清晰的单页图片后重试。")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(stdout.Bytes())
}

type limitedWriter struct {
	buf   *bytes.Buffer
	limit int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if l.buf.Len() < l.limit {
		room := l.limit - l.buf.Len()
		if len(p) > room {
			l.buf.Write(p[:room])
		} else {
			l.buf.Write(p)
		}
	}
	return len(p), nil
}
