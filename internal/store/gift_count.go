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

// refreshGiftCount 在礼金写入成功后直接回写计数缓存，
// 避免下一次账簿列表请求为了数条数而重新反序列化整份 JSON。
// 写入方已持有 s.mu 写锁，这里只操作独立的 countMu。
func (s *Store) refreshGiftCount(eventID string, count int) {
	info, err := os.Stat(s.giftsPath(eventID))
	if err != nil {
		return
	}
	s.countMu.Lock()
	s.giftCounts[eventID] = giftCountEntry{
		size: info.Size(), modTimeNan: info.ModTime().UnixNano(), count: count,
	}
	s.countMu.Unlock()
}

// readGiftsCached 在已持有 s.mu 的前提下读取礼金，命中缓存则省去 JSON 反序列化。
// 返回的是副本，调用方修改不会污染缓存；需要写入时用 writableGifts。
func (s *Store) readGiftsCached(eventID string) (map[string]Record, error) {
	path := s.giftsPath(eventID)
	info, statErr := os.Stat(path)
	if statErr != nil {
		return map[string]Record{}, nil
	}
	size := info.Size()
	modNano := info.ModTime().UnixNano()

	s.cacheMu.RLock()
	entry, hit := s.giftCache[eventID]
	s.cacheMu.RUnlock()
	if hit && entry.size == size && entry.modTimeNan == modNano {
		return cloneRecords(entry.items), nil
	}

	items, err := readMap(path)
	if err != nil {
		return nil, err
	}
	s.cacheMu.Lock()
	s.giftCache[eventID] = giftCacheEntry{size: size, modTimeNan: modNano, items: items}
	s.cacheMu.Unlock()
	return cloneRecords(items), nil
}

// writableGifts 返回可直接修改的副本，写入方改完后调用 putGiftsCache 回写。
func (s *Store) writableGifts(eventID string) (map[string]Record, error) {
	return s.readGiftsCached(eventID)
}

// putGiftsCache 在写入落盘后同步缓存，避免下次读取因 mtime 变化而重新反序列化。
func (s *Store) putGiftsCache(eventID string, items map[string]Record) {
	info, err := os.Stat(s.giftsPath(eventID))
	if err != nil {
		s.invalidateGiftCache()
		return
	}
	s.cacheMu.Lock()
	s.giftCache[eventID] = giftCacheEntry{
		size: info.Size(), modTimeNan: info.ModTime().UnixNano(),
		items: cloneRecords(items),
	}
	s.cacheMu.Unlock()
}

// invalidateGiftCache 整表失效。还原、删除、归档、回收站恢复等外部改写必须调用。
func (s *Store) invalidateGiftCache() {
	s.cacheMu.Lock()
	s.giftCache = make(map[string]giftCacheEntry)
	s.cacheMu.Unlock()
}

func cloneRecords(src map[string]Record) map[string]Record {
	out := make(map[string]Record, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}
