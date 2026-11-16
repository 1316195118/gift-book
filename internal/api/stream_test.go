package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

func TestStreamBroadcastCarriesActorAndIDs(t *testing.T) {
	s := &Server{stream: newStreamHub()}
	ch := s.stream.add("")
	defer s.stream.remove(ch)

	req := httptest.NewRequest("POST", "/api/gifts", nil)
	req.Header.Set("X-Client-Id", "tab-1")
	s.notifyChange(req, "gift", "created", "ev-1", "gift-1")

	select {
	case raw := <-ch:
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("事件不是合法 JSON: %v", err)
		}
		if payload["type"] != "gift" || payload["action"] != "created" {
			t.Fatalf("类型/动作不对: %v", payload)
		}
		if payload["eventId"] != "ev-1" || payload["giftId"] != "gift-1" {
			t.Fatalf("ID 不对: %v", payload)
		}
		if payload["actor"] != "tab-1" {
			t.Fatalf("actor 应透传: %v", payload)
		}
	case <-time.After(300 * time.Millisecond):
		t.Fatal("未收到广播事件")
	}
}

func TestStreamBroadcastFallsBackToQueryActor(t *testing.T) {
	s := &Server{stream: newStreamHub()}
	ch := s.stream.add("")
	defer s.stream.remove(ch)

	req := httptest.NewRequest("POST", "/api/gifts?client=tab-2", nil)
	s.notifyChange(req, "gift", "deleted", "ev-2", "gift-2")

	select {
	case raw := <-ch:
		var payload map[string]any
		_ = json.Unmarshal(raw, &payload)
		if payload["actor"] != "tab-2" {
			t.Fatalf("query 里的 client 应作为 actor: %v", payload)
		}
	case <-time.After(300 * time.Millisecond):
		t.Fatal("未收到广播事件")
	}
}

func TestStreamRemoveStopsDelivery(t *testing.T) {
	s := &Server{stream: newStreamHub()}
	ch := s.stream.add("")
	if s.stream.count() != 1 {
		t.Fatalf("在线连接数应为 1，得到 %d", s.stream.count())
	}
	s.stream.remove(ch)
	if s.stream.count() != 0 {
		t.Fatalf("移除后应为 0，得到 %d", s.stream.count())
	}
	// 已移除的通道不应再被关闭或阻塞广播
	s.notifyChange(httptest.NewRequest("POST", "/api/gifts", nil), "gift", "deleted", "ev", "g")
}

// 实时推送只发给同一家庭，避免跨家庭泄露账簿 ID。
func TestStreamFamilyIsolation(t *testing.T) {
	h := newStreamHub()
	a := h.add("fam_a")
	b := h.add("fam_b")
	defer h.remove(a)
	defer h.remove(b)
	h.broadcast("fam_a", map[string]any{"type": "gift", "eventId": "ev-a"})
	select {
	case <-a:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("同家庭没有收到广播")
	}
	select {
	case <-b:
		t.Fatal("其它家庭收到了广播")
	case <-time.After(200 * time.Millisecond):
	}
}
