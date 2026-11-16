// 离线缓存与待补传队列：只保存密文与公开参数，不保存姓名、金额等明文。
// 缓存与队列按家庭分键，换家庭后不会读到上一家的数据。
const CACHE_BASE = 'giftbook_offline_cache.v2'
const QUEUE_BASE = 'giftbook_offline_queue.v2'
const LEGACY_CACHE = 'giftbook_offline_cache.v1'
const LEGACY_QUEUE = 'giftbook_offline_queue.v1'
const MIGRATED_FLAG = 'giftbook_offline_family_migrated'
const CACHE_MAX_GIFTS = 800

let activeFamily = ''
const familySuffix = () => activeFamily || 'default'
const cacheKey = () => `${CACHE_BASE}:${familySuffix()}`
const queueKey = () => `${QUEUE_BASE}:${familySuffix()}`

// 由启动流程在拿到当前家庭后调用；只影响此后读写哪个家庭的缓存。
export function setCacheFamily(familyId) {
  const next = familyId || ''
  if (next === activeFamily) return
  activeFamily = next
  migrateLegacy()
}

// 单家庭升级到多家庭时，旧缓存没有 familyId，归入默认家庭；只迁移一次。
function migrateLegacy() {
  const suffix = familySuffix()
  if (suffix !== 'default' && suffix !== 'fam_default') return
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return
    if (!localStorage.getItem(cacheKey()) && localStorage.getItem(LEGACY_CACHE)) {
      localStorage.setItem(cacheKey(), localStorage.getItem(LEGACY_CACHE))
    }
    if (!localStorage.getItem(queueKey()) && localStorage.getItem(LEGACY_QUEUE)) {
      localStorage.setItem(queueKey(), localStorage.getItem(LEGACY_QUEUE))
    }
    localStorage.removeItem(LEGACY_CACHE)
    localStorage.removeItem(LEGACY_QUEUE)
    localStorage.setItem(MIGRATED_FLAG, '1')
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function readCache() {
  try {
    const raw = localStorage.getItem(cacheKey())
    const data = raw ? JSON.parse(raw) : null
    return data && typeof data === 'object' ? data : { events: {}, ledgers: {} }
  } catch {
    return { events: {}, ledgers: {} }
  }
}

// 备份恢复后清掉本机缓存的账簿数据，避免离线打开时看到恢复前的旧记录。
export function clearLedgerCache() {
  const cache = readCache()
  writeCache({ ...cache, ledgers: {} })
}

// 整站还原会改动所有家庭：把各家庭的礼金缓存都清掉，避免离线读到旧数据。
export function clearAllLedgerCaches() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith('giftbook_offline_cache.')) keys.push(key)
    }
    keys.forEach((key) => {
      try {
        const data = JSON.parse(localStorage.getItem(key) || 'null')
        if (data && typeof data === 'object') {
          data.ledgers = {}
          localStorage.setItem(key, JSON.stringify(data))
        }
      } catch {
        /* 忽略单个损坏的缓存 */
      }
    })
  } catch {
    /* 隐私模式忽略 */
  }
}

export function writeCache(data) {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(data))
    return true
  } catch {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify({ events: data.events, ledgers: {} }))
    } catch {
      /* 隐私模式忽略 */
    }
    return false
  }
}

const EVENT_CACHE_FIELDS = [
  'id', 'name', 'displayId', 'theme', 'category', 'createdAt', 'startDateTime', 'endDateTime',
  'totalAmount', 'giftCount', 'hasPassword', 'template', 'coverStyle', 'location', 'kdf',
]

export function cacheEventList(allEvents) {
  const data = readCache()
  data.events = {}
  Object.values(allEvents || {}).forEach((ev) => {
    if (!ev || !ev.id) return
    const slim = {}
    EVENT_CACHE_FIELDS.forEach((k) => {
      if (ev[k] !== undefined) slim[k] = ev[k]
    })
    data.events[ev.id] = slim
  })
  Object.keys(data.ledgers || {}).forEach((id) => {
    if (!data.events[id]) delete data.ledgers[id]
  })
  writeCache(data)
}

export function cacheLedgerGifts(eventId, list) {
  const data = readCache()
  data.ledgers = data.ledgers || {}
  const entry = data.ledgers[eventId] || {}
  entry.savedAt = Date.now()
  entry.gifts = list.slice(0, CACHE_MAX_GIFTS).map((g) => ({
    id: g.id,
    encryptedContent: g.encryptedContent,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  }))
  entry.truncated = list.length > CACHE_MAX_GIFTS
  data.ledgers[eventId] = entry
  writeCache(data)
}

export function cacheLedgerVerifier(eventId, verifier) {
  if (!verifier) return
  const data = readCache()
  data.ledgers = data.ledgers || {}
  data.ledgers[eventId] = data.ledgers[eventId] || {}
  data.ledgers[eventId].verifier = verifier
  writeCache(data)
}

export function readLedgerVerifier(eventId) {
  return readCache().ledgers?.[eventId]?.verifier || null
}

export function readCachedLedger(eventId) {
  return readCache().ledgers?.[eventId] || null
}

// ---- 待补传队列 ----

export function readQueue() {
  try {
    const raw = localStorage.getItem(queueKey())
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    const clean = []
    list.forEach((item, index) => {
      if (!item || !item.eventId || typeof item.encryptedContent !== 'string' || !item.encryptedContent) return
      const entry = {
        qid: item.qid ? String(item.qid) : `legacy-${index}-${item.queuedAt || ''}`,
        eventId: String(item.eventId),
        encryptedContent: item.encryptedContent,
        queuedAt: item.queuedAt || new Date().toISOString(),
      }
      if (item.requestId) entry.requestId = String(item.requestId)
      clean.push(entry)
    })
    const encoded = JSON.stringify(clean)
    if (encoded !== raw) {
      try {
        if (clean.length) localStorage.setItem(queueKey(), encoded)
        else localStorage.removeItem(queueKey())
      } catch {
        /* 忽略 */
      }
    }
    return clean
  } catch {
    return []
  }
}

export function writeQueue(list) {
  try {
    if (list.length) localStorage.setItem(queueKey(), JSON.stringify(list))
    else localStorage.removeItem(queueKey())
    return true
  } catch {
    return false
  }
}

export function queueFor(eventId) {
  return readQueue().filter((item) => String(item.eventId) === String(eventId))
}

export function enqueueGift(record) {
  const list = readQueue()
  const item = {
    qid: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    eventId: String(record.eventId),
    encryptedContent: record.encryptedContent,
    queuedAt: new Date().toISOString(),
  }
  if (record.requestId) item.requestId = String(record.requestId)
  list.push(item)
  writeQueue(list)
  return item
}

export function removeQueued(qid) {
  writeQueue(readQueue().filter((item) => item.qid !== qid))
}
