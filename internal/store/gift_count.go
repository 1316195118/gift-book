package store

import (
	"os"
)

// giftCountEntry 用文件大小和纳秒级修改时间验证缓存。
// Store 之外的进程替换 JSON 文件时，下一次 Count 也会因元数据不同重新读取。
type giftCountEntry struct {
	size       int64
	modTimeNan int64
	count      int
}

// countGifts 在已持有的读锁内统计一批账簿。
// 单独封装是为了让 /api/events 一次请求只拿一次读锁，同时避免重复 JSON 反序列化。
func (s *Store) countGifts(eventIDs []string, out map[string]int) {
	for _, id := range eventIDs {
		path := s.giftsPath(id)
		info, statErr := os.Stat(path)
		if statErr != nil {
			// 账簿可能还没有礼金文件；这是正常状态，不是数据损坏。
			out[id] = 0
			continue
		}
		size := info.Size()
		modNano := info.ModTime().UnixNano()

		s.countMu.RLock()
		entry, cached := s.giftCounts[id]
		s.countMu.RUnlock()
		if cached && entry.size == size && entry.modTimeNan == modNano {
			out[id] = entry.count
			continue
		}

		gifts, err := readMap(path)
		if err != nil {
			// CountGifts 的既有约定是损坏或读取失败不阻塞账簿列表。
			out[id] = 0
			continue
		}
		count := len(gifts)
		s.countMu.Lock()
		s.giftCounts[id] = giftCountEntry{size: size, modTimeNan: modNano, count: count}
		s.countMu.Unlock()
		out[id] = count
	}
}

// CountGifts 统计单本账簿的人数。
func (s *Store) CountGifts(eventID string) int {
	counts := s.CountGiftsMany([]string{eventID})
	return counts[eventID]
}

// CountGiftsMany 在一次读锁内统计多本账簿，供账簿列表和健康概况复用。
func (s *Store) CountGiftsMany(eventIDs []string) map[string]int {
	out := make(map[string]int, len(eventIDs))
	s.mu.RLock()
	s.countGifts(eventIDs, out)
	s.mu.RUnlock()
	return out
}
