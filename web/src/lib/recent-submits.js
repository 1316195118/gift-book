// 本机最近提交（含已进离线队列、尚未出现在礼簿里的）：用于拦住短时间内的重复录入。
// 独立成模块，便于单测与复用；数据只存 sessionStorage，不跨设备。
const RECENT_KEY = 'gb-recent-submits'
export const RECENT_WINDOW = 10 * 60 * 1000
export const RECENT_NAME_WINDOW = 2 * 60 * 1000

export function readRecentSubmits() {
  try {
    const list = JSON.parse(sessionStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function noteRecentSubmit(name, amount) {
  try {
    const now = Date.now()
    const list = readRecentSubmits().filter((item) => now - Number(item.at) < RECENT_WINDOW)
    list.push({ name: String(name || '').trim(), amount: Number(amount) || 0, at: now })
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(-200)))
  } catch {
    /* 隐私模式禁用存储时忽略，仍靠礼簿内查重 */
  }
}

export function findRecentSubmit(name, amount) {
  const now = Date.now()
  return readRecentSubmits().find((item) => item.name === name
    && Math.abs(Number(item.amount) - Number(amount)) < 0.005
    && now - Number(item.at) <= RECENT_WINDOW)
}

export function findRecentName(name) {
  const now = Date.now()
  return readRecentSubmits().find((item) => item.name === name && now - Number(item.at) <= RECENT_NAME_WINDOW)
}
