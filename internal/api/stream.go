// SSE 实时同步：任何设备写入后，向其它在线页面广播一条「变了」的通知。
// 只广播 id/类型，不含礼金内容（密文只走 REST），前端收到后自行重拉。
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type streamHub struct {
	mu      sync.Mutex
	clients map[chan []byte]string // 信道 -> 家庭 ID
}

func newStreamHub() *streamHub {
	return &streamHub{clients: make(map[chan []byte]string)}
}

func (h *streamHub) add(familyID string) chan []byte {
	ch := make(chan []byte, 16)
	h.mu.Lock()
	h.clients[ch] = familyID
	h.mu.Unlock()
	return ch
}

func (h *streamHub) remove(ch chan []byte) {
	h.mu.Lock()
	if _, ok := h.clients[ch]; ok {
		delete(h.clients, ch)
		close(ch)
	}
	h.mu.Unlock()
}

func (h *streamHub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

// broadcast 非阻塞推送：慢客户端丢这一条，等它下次事件或重连后自行补齐。
func (h *streamHub) broadcast(familyID string, payload map[string]any) {
	msg, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch, clientFamily := range h.clients {
		if clientFamily != familyID {
			continue
		}
		select {
		case ch <- msg:
		default:
		}
	}
}

// broadcastAll 向所有家庭广播，仅用于整站还原这类会影响全部数据的操作。
func (h *streamHub) broadcastAll(payload map[string]any) {
	msg, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
		}
	}
}

// notifyAllChange 通知所有在线页面刷新；只用于整站级操作，不携带家庭数据。
func (s *Server) notifyAllChange(r *http.Request, kind, action string) {
	actor := r.Header.Get("X-Client-Id")
	if actor == "" {
		actor = r.URL.Query().Get("client")
	}
	s.stream.broadcastAll(map[string]any{
		"type":   kind,
		"action": action,
		"actor":  actor,
		"at":     time.Now().UnixMilli(),
	})
}

// notifyChange 在写操作成功后广播。actor 用于让发起方忽略自己的事件。
func (s *Server) notifyChange(r *http.Request, kind, action, eventID, giftID string) {
	familyID := ""
	if s.store != nil {
		family, ok := s.resolveFamily(r)
		if !ok {
			return // 没有家庭上下文（例如站点管理员整站操作）不广播，避免跨家庭泄露
		}
		familyID = family.ID
	}
	actor := r.Header.Get("X-Client-Id")
	if actor == "" {
		actor = r.URL.Query().Get("client")
	}
	s.stream.broadcast(familyID, map[string]any{
		"type":    kind,
		"action":  action,
		"eventId": eventID,
		"giftId":  giftID,
		"actor":   actor,
		"at":      time.Now().UnixMilli(),
	})
}

// handleStream 处理 GET /api/stream（text/event-stream）。
func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	family, familyOK := s.requireFamily(w, r)
	if !familyOK {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "当前连接不支持实时推送")
		return
	}
	// 长连接必须清掉服务器的写超时，否则会被 WriteTimeout 切断。
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := s.stream.add(family.ID)
	defer s.stream.remove(ch)

	fmt.Fprint(w, "event: ready\ndata: {\"ok\":true}\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if _, err := fmt.Fprintf(w, "event: change\ndata: %s\n\n", msg); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
