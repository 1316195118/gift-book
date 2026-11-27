package api

import (
	"net/http"
	"testing"
)

// 未登录时检查更新接口仍可用（不含敏感信息），安装接口必须管理员。
func TestUpdateEndpoints(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "GET", "/api/update/status", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("状态接口应可访问: %d", res.StatusCode)
	}
	data := payload["data"].(map[string]any)
	if data["version"] == nil {
		t.Fatalf("状态接口缺少版本: %v", data)
	}

	// 单家庭开放模式下 isSiteAdmin 认本机回环，httptest 是 127.0.0.1，
	// 所以这里安装接口会放行；重点是验证不带 tag 的请求被拒（需先 check）。
	res, _ = env.do(t, "POST", "/api/update/apply", map[string]any{"tag": "fake"}, nil)
	if res.StatusCode == http.StatusOK {
		t.Fatalf("伪造标签不应安装成功")
	}
}

func TestUpdateStatusNoUpdaterWithoutConfig(t *testing.T) {
	env := newEnv(t)
	res, payload := env.do(t, "GET", "/api/update/status", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatal(res.StatusCode)
	}
	if payload["success"] != true {
		t.Fatalf("状态接口失败: %v", payload)
	}
}

func TestMaskProxy(t *testing.T) {
	cases := map[string]string{
		"":                                  "",
		"http://10.10.10.254:7890":          "http://10.10.10.254:7890",
		"http://user:pass@proxy.local:8080": "http://user:****@proxy.local:8080",
		"http://user@proxy.local:8080":      "http://user@proxy.local:8080",
	}
	for in, want := range cases {
		if got := maskProxy(in); got != want {
			t.Errorf("maskProxy(%q) = %q, want %q", in, got, want)
		}
	}
}
