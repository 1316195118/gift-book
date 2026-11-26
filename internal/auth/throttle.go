package auth

// 登录防爆破：按来源 IP 记录失败次数，连续失败后指数退避锁定。

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"os"
	"sort"
	"strconv"
	"time"
)

const (
	throttleStorageLock = 60
	throttleBaseLock    = 15
	throttleMaxLock     = 15 * 60
	throttleDedupe      = 2
)

// thrustRow 是单个 IP 的失败计数。
type thrustRow struct {
	Fails   int    `json:"fails"`
	Until   int64  `json:"until"`
	Strikes int    `json:"strikes"`
	Last    int64  `json:"last"`
	LastKey string `json:"lastKey,omitempty"`
}

// readThrottle 读防爆破表；缓存按文件 stamp 失效，避免每次校验都读盘+解析。
// 调用方须持有 m.mu。
func (m *Manager) readThrottle() map[string]thrustRow {
	now := time.Now().Unix()
	if m.throttleFailureUntil > 0 && m.throttleFailureUntil <= now {
		// 冷却期结束后强制重新探测磁盘；仍不可写时会再次进入 fail-closed。
		m.throttleFailureUntil = 0
		m.throttleLoaded = false
	}
	stamp := statFile(m.throttlePath())
	if m.throttleLoaded && stamp == m.throttleStamp {
		return m.throttleCache
	}
	out := map[string]thrustRow{}
	if stamp.exists {
		raw, err := os.ReadFile(m.throttlePath())
		if err == nil {
			if err := json.Unmarshal(raw, &out); err != nil {
				out = map[string]thrustRow{}
				m.lockThrottleStorage()
			}
		} else {
			m.lockThrottleStorage()
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
func (m *Manager) writeThrottle(data map[string]thrustRow) error {
	payload, err := json.Marshal(data)
	if err != nil {
		m.throttleLoaded = false
		m.lockThrottleStorage()
		return err
	}
	tmp := m.throttlePath() + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		m.throttleLoaded = false
		m.lockThrottleStorage()
		return err
	}
	if err := os.Rename(tmp, m.throttlePath()); err != nil {
		m.throttleLoaded = false
		m.lockThrottleStorage()
		return err
	}
	m.throttleCache = data
	m.throttleStamp = statFile(m.throttlePath())
	m.throttleLoaded = true
	m.throttleFailureUntil = 0
	return nil
}

func (m *Manager) lockThrottleStorage() {
	until := time.Now().Unix() + throttleStorageLock
	if until > m.throttleFailureUntil {
		m.throttleFailureUntil = until
	}
}

func (m *Manager) throttleStatus(ip string) thrustRow {
	now := time.Now().Unix()
	if m.throttleFailureUntil > now {
		return thrustRow{Until: m.throttleFailureUntil}
	}
	row, ok := m.readThrottle()[ip]
	if !ok {
		return thrustRow{}
	}
	return row
}

func (m *Manager) throttleFail(ip, attempt string) thrustRow {
	data := m.readThrottle()
	row := data[ip]
	now := time.Now().Unix()
	if m.throttleFailureUntil > now {
		row.Until = m.throttleFailureUntil
		return row
	}
	// 双击、回车与按钮同时触发等网络层重复请求，不应把用户的一次输入算成两次。
	// 用进程随机密钥做 HMAC，避免把访问码的普通摘要写进防爆破文件。
	attemptKey := m.attemptFingerprint(attempt)
	if attemptKey != "" && row.LastKey == attemptKey && now-row.Last <= throttleDedupe {
		return row
	}
	if now-row.Last > 900 {
		row.Fails = 0
		row.Strikes = 0
	}
	row.Fails++
	row.Last = now
	row.LastKey = attemptKey
	if row.Fails >= 5 {
		row.Strikes++
		if row.Strikes > 6 {
			row.Strikes = 6
		}
		lock := throttleBaseLock * (1 << (row.Strikes - 1))
		if lock > throttleMaxLock {
			lock = throttleMaxLock
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
	if err := m.writeThrottle(data); err != nil {
		row.Until = m.throttleFailureUntil
	}
	return row
}

func (m *Manager) attemptFingerprint(attempt string) string {
	if attempt == "" || len(m.throttleAttemptKey) == 0 {
		return ""
	}
	mac := hmac.New(sha256.New, m.throttleAttemptKey)
	mac.Write([]byte(attempt))
	return hexString(mac.Sum(nil))
}

func hexString(raw []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, len(raw)*2)
	for i, value := range raw {
		out[i*2] = digits[value>>4]
		out[i*2+1] = digits[value&0x0f]
	}
	return string(out)
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
		_ = m.writeThrottle(data)
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
// attempt 只用于识别短时间内的同一请求，不会写入文件。
func (m *Manager) ThrottleFail(ip, attempt string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.throttleFail(ip, attempt).Fails
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

// ThrottleTarget 为同一来源下的不同验证对象生成独立计数键。
// 例如同一户家庭里输入错另一本账簿，不会锁住当前账簿。
func ThrottleTarget(scope, ip, subject string) string {
	if subject == "" {
		return scope + ":" + ip
	}
	return scope + ":" + ip + ":" + subject
}

// RetryAfterSeconds 向上取整，返回 Retry-After 需要的秒数。
func RetryAfterSeconds(retry time.Duration) int {
	if retry <= 0 {
		return 1
	}
	return int((retry + time.Second - 1) / time.Second)
}

// RetryAfterLabel 给出用户可读的剩余时间；不足一分钟按秒显示。
func RetryAfterLabel(retry time.Duration) string {
	seconds := RetryAfterSeconds(retry)
	if seconds < 60 {
		return strconv.Itoa(seconds) + " 秒"
	}
	return strconv.Itoa((seconds+59)/60) + " 分钟"
}
