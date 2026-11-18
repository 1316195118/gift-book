// 本机最近提交（含已进离线队列、尚未出现在礼簿里的）：用于拦住短时间内的重复录入。
// 独立成模块，便于单测与复用；数据只存 sessionStorage，不跨设备。
const RECENT_KEY = 'gb-recent-submits'
// 按家庭 + 账簿隔离：切换家庭或账簿后不会拿上一家的记录误报重复。
const keyOf = (scope) => `${RECENT_KEY}:${scope || 'default'}`
export const RECENT_WINDOW = 10 * 60 * 1000
export const RECENT_NAME_WINDOW = 2 * 60 * 1000

export function readRecentSubmits(scope = '') {
  try {
    const list = JSON.parse(sessionStorage.getItem(keyOf(scope)) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function noteRecentSubmit(name, amount, scope = '') {
  try {
    const now = Date.now()
    const list = readRecentSubmits(scope).filter((item) => now - Number(item.at) < RECENT_WINDOW)
    list.push({ name: String(name || '').trim(), amount: Number(amount) || 0, at: now })
    sessionStorage.setItem(keyOf(scope), JSON.stringify(list.slice(-200)))
  } catch {
    /* 隐私模式禁用存储时忽略，仍靠礼簿内查重 */
  }
}

export function findRecentSubmit(name, amount, scope = '') {
  const now = Date.now()
  return readRecentSubmits(scope).find((item) => item.name === name
    && Math.abs(Number(item.amount) - Number(amount)) < 0.005
    && now - Number(item.at) <= RECENT_WINDOW)
}

export function findRecentName(name, scope = '') {
  const now = Date.now()
  return readRecentSubmits(scope).find((item) => item.name === name && now - Number(item.at) <= RECENT_NAME_WINDOW)
}
