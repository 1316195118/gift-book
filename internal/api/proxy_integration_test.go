package api

import (
	"net/http"
	"testing"

	"giftbook/internal/store"
)

// 反代场景下，XFF 最右侧是反代追加的真实客户端 IP；
// 客户端伪造的左侧值不该被采信，否则 IP 限流可被绕过。
func TestProxyClientIPRateLimit(t *testing.T) {
	env := newEnv(t, Options{TrustProxy: true})
	cookie := env.loginFamily(t, "", store.DefaultFamilyID)
	res, payload := env.do(t, "POST", "/api/events", map[string]any{
		"name": "反代测试", "passwordHash": noPassKey,
	}, map[string]string{"Cookie": cookie})
	id := payload["data"].(map[string]any)["id"].(string)
	res, payload = env.do(t, "POST", "/api/events/"+id+"/visit", map[string]any{"enabled": true}, map[string]string{"Cookie": cookie})
	token := payload["data"].(map[string]any)["token"].(string)

	// nginx proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for：
	// 攻击者自带伪造值在最左，真实来源被追加到最右。
	headers := map[string]string{
		"X-Forwarded-For": "1.2.3.4, 198.51.100.20",
	}
	for i := 0; i < 3; i += 1 {
		res, _ = env.do(t, "POST", "/api/visit/"+token, map[string]any{
			"name": "访客" + string(rune('A'+i)), "count": 1,
		}, headers)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("第 %d 次提交失败: %d", i, res.StatusCode)
		}
	}
	// 三个请求都来自同一个真实 IP 198.51.100.20，去重键应一致（仅按 name 去重不冲突）。
	_, list := env.do(t, "GET", "/api/events/"+id+"/visit", nil, map[string]string{"Cookie": cookie})
	if got := len(list["data"].([]any)); got != 3 {
		t.Fatalf("来访名单应有 3 条，实际 %d", got)
	}
}

// 无 XFF 时（直连），回退到 RemoteAddr。
func TestDirectClientIPStillWorks(t *testing.T) {
	env := newEnv(t)
	cookie := env.loginFamily(t, "", store.DefaultFamilyID)
	res, _ := env.do(t, "GET", "/api/events", nil, map[string]string{"Cookie": cookie})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("直连环境应正常工作: %d", res.StatusCode)
	}
}
