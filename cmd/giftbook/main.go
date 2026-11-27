// Command giftbook 是电子礼簿的单一可执行文件：内嵌 Vue 前端、JSON 文件存储。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"giftbook"
	"giftbook/internal/api"
	"giftbook/internal/auth"
	"giftbook/internal/store"
)

// appVersion 允许通过 -ldflags "-X main.appVersion=X.Y.Z" 覆盖；
// 默认从嵌入的 build.json 读取，保证版本号只有「构建产物」一个来源。
var appVersion = ""

var (
	flagPort    = flag.Int("port", 8099, "监听端口")
	flagAddr    = flag.String("addr", "0.0.0.0", "监听地址")
	flagData    = flag.String("data", "", "数据目录（默认可执行文件旁的 data/）")
	flagConfig  = flag.String("config", "", "配置目录（默认可执行文件旁的 config/）")
	flagOpen    = flag.Bool("open", false, "启动后打开浏览器")
	flagVersion = flag.Bool("version", false, "显示版本后退出")
)

func main() {
	flag.Parse()
	appVersion = resolveAppVersion()
	if *flagVersion {
		fmt.Printf("giftbook %s (%s/%s)\n", appVersion, runtime.GOOS, runtime.GOARCH)
		return
	}

	baseDir := executableDir()
	// 显式指定目录（参数或环境变量）意味着自定义部署或测试实例，
	// 此时不做旧目录迁移，避免把 rundata/ 复制到临时目录里。
	customDirs := false
	dataDir := *flagData
	if dataDir != "" {
		customDirs = true
	} else if env := os.Getenv("GIFTBOOK_DATA_DIR"); env != "" {
		dataDir = env
		customDirs = true
	} else {
		dataDir = filepath.Join(baseDir, "data")
	}
	configDir := *flagConfig
	if configDir != "" {
		customDirs = true
	} else if env := os.Getenv("GIFTBOOK_CONFIG_DIR"); env != "" {
		configDir = env
		customDirs = true
	} else {
		// 配置与数据分开：data/ 只放账簿 JSON，其余全部放 config/。
		configDir = filepath.Join(baseDir, "config")
	}
	if abs, err := filepath.Abs(dataDir); err == nil {
		dataDir = abs
	}
	if abs, err := filepath.Abs(configDir); err == nil {
		configDir = abs
	}

	// 旧版把 events.json、认证状态、备份包都放在 rundata/。默认目录启动时检测一次，
	// 复制到新的 data/ + config/；只复制不删除，失败不阻断启动。
	// 必须在 store.Open 之前跑，那时 data/events.json 还没生成。
	if !customDirs {
		migrateLegacyLayout(baseDir, dataDir, configDir)
	}

	assets, err := fs.Sub(giftbook.Assets, giftbook.Dist)
	if err != nil {
		log.Fatalf("无法加载内嵌前端: %v", err)
	}

	st, err := store.Open(dataDir)
	if err != nil {
		log.Fatalf("无法打开数据目录 %s: %v", dataDir, err)
	}
	trustProxy := envBool("GIFTBOOK_TRUST_PROXY")
	trustProxyHops := 1
	if raw := strings.TrimSpace(os.Getenv("GIFTBOOK_TRUST_PROXY_HOPS")); raw != "" {
		if n, parseErr := strconv.Atoi(raw); parseErr == nil && n >= 1 && n <= 8 {
			trustProxyHops = n
		} else {
			log.Printf("GIFTBOOK_TRUST_PROXY_HOPS 无效（%q），使用默认 1", raw)
		}
	}
	authMgr, err := auth.NewWithOptions(configDir, auth.Options{
		TrustProxy:     trustProxy,
		TrustProxyHops: trustProxyHops,
		SetupToken:     strings.TrimSpace(os.Getenv("GIFTBOOK_SETUP_TOKEN")),
	})
	if err != nil {
		log.Fatalf("无法打开配置目录 %s: %v", configDir, err)
	}

	ocr := api.OCREngine{
		Python: envOr("GIFTBOOK_OCR_PYTHON", filepath.Join(baseDir, "ocr", "venv", "bin", "python")),
		Script: envOr("GIFTBOOK_OCR_SCRIPT", filepath.Join(baseDir, "ocr", "recognize.py")),
		Root:   filepath.Join(baseDir, "ocr"),
	}

	handler := api.New(api.Options{
		Store:       st,
		Auth:        authMgr,
		Assets:      assets,
		Build:       buildLabel(),
		Version:     appVersion,
		OCR:         ocr,
		ConfigDir:   configDir,
		AutoRestart: envBool("GIFTBOOK_AUTO_RESTART"),
		ForceHTTPS:  envBool("GIFTBOOK_FORCE_HTTPS"),
		PublicURL:   strings.TrimSpace(os.Getenv("GIFTBOOK_PUBLIC_URL")),
		TrustProxy:  trustProxy,
	})
	handler.StartAutoBackup()

	addr := fmt.Sprintf("%s:%d", *flagAddr, *flagPort)
	server := &http.Server{
		Addr:              addr,
		Handler:           handler.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       120 * time.Second,
		WriteTimeout:      180 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	url := fmt.Sprintf("http://127.0.0.1:%d/", *flagPort)
	log.Printf("电子礼簿 %s 已启动，访问地址 %s", appVersion, url)
	log.Printf("数据目录: %s", dataDir)
	log.Printf("配置目录: %s", configDir)

	if *flagOpen {
		go func() {
			time.Sleep(600 * time.Millisecond)
			openBrowser(url)
		}()
	}

	stopped := make(chan struct{})
	shutdown := func(reason string) {
		log.Printf("正在停止（%s）…", reason)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("停止失败: %v", err)
		}
		// 等后台定时备份收尾，避免进程退出时留下半个 zip。
		handler.StopAutoBackup()
	}
	go func() {
		defer close(stopped)
		ch := make(chan os.Signal, 1)
		signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
		select {
		case <-ch:
			shutdown("signal")
		case <-handler.RestartChannel():
			shutdown("self-update")
		}
	}()

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("服务启动失败: %v", err)
	}
	<-stopped
	log.Println("已停止")
}

func executableDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe)
}

// buildInfo 读取嵌入的 build.json，返回构建号与版本号。
func buildInfo() (build, version string) {
	raw, err := fs.ReadFile(giftbook.Assets, giftbook.Dist+"/build.json")
	if err != nil {
		return "dev", ""
	}
	var info struct {
		Build   string `json:"build"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &info); err != nil {
		return "dev", ""
	}
	if info.Build == "" {
		info.Build = "dev"
	}
	return info.Build, info.Version
}

func buildLabel() string {
	build, _ := buildInfo()
	return build
}

// resolveAppVersion 优先用 ldflags 注入值，否则用 build.json 的 version。
func resolveAppVersion() string {
	if v := strings.TrimSpace(appVersion); v != "" {
		return v
	}
	_, version := buildInfo()
	if version == "" {
		return "dev"
	}
	return version
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envBool(key string) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	return value == "1" || value == "true" || value == "yes"
}

func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = exec.Command("xdg-open", url).Start()
	}
	if err != nil {
		log.Printf("无法自动打开浏览器: %v", err)
	}
}
