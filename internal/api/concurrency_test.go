package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"testing"
)

// 多人同时刷新和录入时，GET 走共享读锁，POST 串行写入，不能出现 5xx、重复
// 请求被重复保存或最后一笔覆盖前一笔。
func TestConcurrentGiftHTTPReadsAndWrites(t *testing.T) {
	env := newEnv(t)
	eventID := env.createEvent(t, "并发压测账簿", noPassKey)

	const writers = 40
	const readers = 40
	const readsPerClient = 15
	client := &http.Client{Transport: http.DefaultTransport}
	start := make(chan struct{})
	errs := make(chan error, writers+readers)
	var wg sync.WaitGroup
	wg.Add(writers + readers)

	for i := 0; i < writers; i++ {
		go func(i int) {
			defer wg.Done()
			<-start
			body, _ := json.Marshal(map[string]any{
				"eventId":          eventID,
				"encryptedContent": validCipher(byte(i + 1)),
				"requestId":        fmt.Sprintf("load-request-%03d", i),
			})
			res, err := client.Post(env.server.URL+"/api/gifts", "application/json", bytes.NewReader(body))
			if err != nil {
				errs <- err
				return
			}
			defer res.Body.Close()
			raw, _ := io.ReadAll(res.Body)
			if res.StatusCode != http.StatusOK {
				errs <- fmt.Errorf("写入 %d 返回 %d: %s", i, res.StatusCode, raw)
				return
			}
			errs <- nil
		}(i)
	}
	for i := 0; i < readers; i++ {
		go func(i int) {
			defer wg.Done()
			<-start
			for j := 0; j < readsPerClient; j++ {
				res, err := client.Get(env.server.URL + "/api/gifts?eventId=" + eventID)
				if err != nil {
					errs <- err
					return
				}
				raw, readErr := io.ReadAll(res.Body)
				res.Body.Close()
				if readErr != nil {
					errs <- readErr
					return
				}
				if res.StatusCode != http.StatusOK {
					errs <- fmt.Errorf("读取 %d-%d 返回 %d: %s", i, j, res.StatusCode, raw)
					return
				}
				var payload response
				if err := json.Unmarshal(raw, &payload); err != nil || !payload.Success {
					errs <- fmt.Errorf("读取 %d-%d 返回无效 JSON: %v %s", i, j, err, raw)
					return
				}
			}
			errs <- nil
		}(i)
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	gifts, err := env.store.ReadGifts(eventID)
	if err != nil {
		t.Fatal(err)
	}
	if len(gifts) != writers {
		t.Fatalf("并发写入后应保存 %d 条礼金，实际 %d", writers, len(gifts))
	}
}
