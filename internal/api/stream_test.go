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

func TestStreamBroadcastReachesAllFamilyClients(t *testing.T) {
	h := newStreamHub()
	const clients = 32
	channels := make([]chan []byte, 0, clients)
	for i := 0; i < clients; i++ {
		ch := h.add("fam_busy")
		channels = append(channels, ch)
		defer h.remove(ch)
	}

	h.broadcast("fam_busy", map[string]any{"type": "gift", "eventId": "ev-1"})
	for i, ch := range channels {
		select {
		case raw := <-ch:
			var payload map[string]any
			if err := json.Unmarshal(raw, &payload); err != nil {
				t.Fatalf("客户端 %d 收到非法事件: %v", i, err)
			}
			if payload["eventId"] != "ev-1" {
				t.Fatalf("客户端 %d 收到错误事件: %v", i, payload)
			}
		case <-time.After(500 * time.Millisecond):
			t.Fatalf("客户端 %d 没收到广播", i)
		}
	}
}

func TestStreamSlowClientDoesNotBlockOthers(t *testing.T) {
	h := newStreamHub()
	slow := h.add("fam_busy")
	fast := h.add("fam_busy")
	defer h.remove(slow)
	defer h.remove(fast)
	for i := 0; i < cap(slow); i++ {
		slow <- []byte(`{"queued":true}`)
	}

	done := make(chan struct{})
	go func() {
		h.broadcast("fam_busy", map[string]any{"type": "gift", "eventId": "ev-fast"})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("慢客户端阻塞了广播")
	}
	select {
	case raw := <-fast:
		var payload map[string]any
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["eventId"] != "ev-fast" {
			t.Fatalf("正常客户端收到错误事件: %v", payload)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("正常客户端被慢客户端拖住")
	}
}
