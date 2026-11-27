package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sort"
	"time"
)

// Visit 是一条来访登记：户主姓名 + 人数 + 备注。
// 它不加密、不含金额，只用于统计到场人数与名单；跟随账簿存于 events.json，
// 因此备份、还原、删除、家庭隔离全部自动继承礼簿既有机制。
type Visit struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Count     int    `json:"count"`
	Note      string `json:"note"`
	CreatedAt string `json:"createdAt"`
}

// visitsKey 是 event 记录里存放来访名单的字段名。
const visitsKey = "visits"

// Visits 返回某本账簿的来访名单，按登记时间升序。
func (s *Store) Visits(eventID string) ([]Visit, error) {
	events, err := s.ReadEvents()
	if err != nil {
		return nil, err
	}
	event, ok := events[eventID]
	if !ok {
		return nil, ErrNotFound
	}
	return parseVisits(event[visitsKey]), nil
}

// parseVisits 从 event 字段解析来访名单，兼容字段缺失或格式异常。
func parseVisits(raw any) []Visit {
	items, ok := raw.([]any)
	if !ok {
		if typed, ok := raw.([]Visit); ok {
			return typed
		}
		return []Visit{}
	}
	result := make([]Visit, 0, len(items))
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		v := Visit{}
		v.ID, _ = obj["id"].(string)
		v.Name, _ = obj["name"].(string)
		v.Note, _ = obj["note"].(string)
		v.CreatedAt, _ = obj["createdAt"].(string)
		if count, ok := obj["count"].(float64); ok {
			v.Count = int(count)
		} else if count, ok := obj["count"].(int); ok {
			v.Count = count
		}
		result = append(result, v)
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].CreatedAt < result[j].CreatedAt })
	return result
}

// AddVisit 在写锁内追加一条来访登记，直接落到 events.json。
// 同名 5 分钟内重复提交会被忽略，避免来宾连点造成重复计数。
func (s *Store) AddVisit(eventID string, visit Visit) error {
	return s.WithEvents(func(events map[string]Record) (bool, error) {
		event, ok := events[eventID]
		if !ok {
			return false, ErrNotFound
		}
		current := parseVisits(event[visitsKey])
		if len(current) >= 1000 {
			return false, errors.New("来访登记已满，请主家先清理名单")
		}
		for _, old := range current {
			if old.Name == visit.Name {
				if created, err := time.Parse(time.RFC3339, old.CreatedAt); err == nil && func() bool {
					d := time.Since(created)
					return d >= 0 && d < 5*time.Minute
				}() {
					return false, nil
				}
			}
		}
		current = append(current, visit)
		event[visitsKey] = current
		events[eventID] = event
		return true, nil
	})
}

// RemoveVisit 删除一条来访登记（主家纠错用）。
func (s *Store) RemoveVisit(eventID, visitID string) error {
	return s.WithEvents(func(events map[string]Record) (bool, error) {
		event, ok := events[eventID]
		if !ok {
			return false, ErrNotFound
		}
		current := parseVisits(event[visitsKey])
		kept := current[:0]
		found := false
		for _, v := range current {
			if v.ID == visitID {
				found = true
				continue
			}
			kept = append(kept, v)
		}
		if !found {
			return false, errors.New("记录不存在")
		}
		event[visitsKey] = kept
		events[eventID] = event
		return true, nil
	})
}

// ClearVisits 清空某本账簿的来访名单（关闭登记时可选调用）。
func (s *Store) ClearVisits(eventID string) error {
	return s.WithEvents(func(events map[string]Record) (bool, error) {
		event, ok := events[eventID]
		if !ok {
			return false, ErrNotFound
		}
		if len(parseVisits(event[visitsKey])) == 0 {
			return false, nil
		}
		event[visitsKey] = []Visit{}
		events[eventID] = event
		return true, nil
	})
}

// RandomVisitID 生成来访记录 ID。
func RandomVisitID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return time.Now().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(buf)
}
