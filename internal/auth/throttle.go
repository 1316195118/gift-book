package auth

// 登录防爆破：按来源 IP 记录失败次数，连续失败后指数退避锁定。

import (
	"encoding/json"
	"os"
	"sort"
	"time"
)

// thrustRow 是单个 IP 的失败计数。
type thrustRow struct {
	Fails   int   `json:"fails"`
	Until   int64 `json:"until"`
	Strikes int   `json:"strikes"`
	Last    int64 `json:"last"`
}

// readThrottle 读防爆破表；缓存按文件 stamp 失效，避免每次校验都读盘+解析。
// 调用方须持有 m.mu。
func (m *Manager) readThrottle() map[string]thrustRow {
	stamp := statFile(m.throttlePath())
	if m.throttleLoaded && stamp == m.throttleStamp {
		return m.throttleCache
	}
	out := map[string]thrustRow{}
	if stamp.exists {
		raw, err := os.ReadFile(m.throttlePath())
		if err == nil {
			_ = json.Unmarshal(raw, &out)
		}
		if out == nil {
			out = map[string]thrustRow{}
		}
	}
	m.throttleCache = out
	m.throttleStamp = stamp
	m.throttleLoaded = true
	return out
}

// writeThrottle 写回并刷新缓存；任何失败都让缓存失效，下次强制重读文件，
// 避免内存里留下与磁盘不一致的失败计数。调用方须持有 m.mu。
func (m *Manager) writeThrottle(data map[string]thrustRow) {
	payload, err := json.Marshal(data)
	if err != nil {
		m.throttleLoaded = false
		return
	}
	tmp := m.throttlePath() + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		m.throttleLoaded = false
		return
	}
	if err := os.Rename(tmp, m.throttlePath()); err != nil {
		m.throttleLoaded = false
		return
	}
	m.throttleCache = data
	m.throttleStamp = statFile(m.throttlePath())
	m.throttleLoaded = true
}

func (m *Manager) throttleStatus(ip string) thrustRow {
	row, ok := m.readThrottle()[ip]
	if !ok {
		return thrustRow{}
	}
	return row
}

func (m *Manager) throttleFail(ip string) thrustRow {
	data := m.readThrottle()
	row := data[ip]
	now := time.Now().Unix()
	if now-row.Last > 900 {
		row.Fails = 0
		row.Strikes = 0
	}
	row.Fails++
	row.Last = now
	if row.Fails >= 5 {
		row.Strikes++
		if row.Strikes > 6 {
			row.Strikes = 6
		}
		lock := 60 * (1 << (row.Strikes - 1))
		if lock > 1800 {
			lock = 1800
		}
		row.Until = now + int64(lock)
		row.Fails = 0
	}
	data[ip] = row
	for key, item := range data {
		if now-item.Last > 86400 {
			delete(data, key)
		}
	}
	if len(data) > maxThrottleRows {
		m.pruneThrottle(data)
	}
	m.writeThrottle(data)
	return row
}

// pruneThrottle 在来源过多时删除最久未活动的记录，避免防爆破文件无限膨胀。
func (m *Manager) pruneThrottle(data map[string]thrustRow) {
	type item struct {
		key  string
		last int64
	}
	items := make([]item, 0, len(data))
	for key, row := range data {
		items = append(items, item{key: key, last: row.Last})
	}
	// 按最后活动时间升序，一次排序后删掉最旧的一批，避免 O(n²) 反复扫描。
	sort.Slice(items, func(i, j int) bool { return items[i].last < items[j].last })
	for i := 0; i < len(items)-maxThrottleRows; i++ {
		delete(data, items[i].key)
	}
}

func (m *Manager) throttleClear(ip string) {
	data := m.readThrottle()
	if _, ok := data[ip]; ok {
		delete(data, ip)
		m.writeThrottle(data)
	}
}

// ThrottleLocked 报告该来源当前是否处于锁定中。
func (m *Manager) ThrottleLocked(ip string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.throttleStatus(ip).Until > time.Now().Unix()
}

// ThrottleRetryAfter 返回剩余锁定时间。
func (m *Manager) ThrottleRetryAfter(ip string) time.Duration {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := m.throttleStatus(ip)
	left := time.Until(time.Unix(row.Until, 0))
	if left < 0 {
		return 0
	}
	return left
}

// ThrottleFail 记录一次失败并返回当前失败次数。
func (m *Manager) ThrottleFail(ip string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.throttleFail(ip).Fails
}

// ThrottleClear 清空该来源的失败记录。
func (m *Manager) ThrottleClear(ip string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.throttleClear(ip)
}

// ThrottleFails 返回当前累计失败次数（含锁定前）。
func (m *Manager) ThrottleFails(ip string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := m.throttleStatus(ip)
	if row.Fails > 0 {
		return row.Fails
	}
	// 刚触发锁定时计数已清零，按阈值返回，提示语才对。
	if row.Until > time.Now().Unix() {
		return 5
	}
	return 0
}
