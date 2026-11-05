// 离线缓存与待补传队列：只保存密文与公开参数，不保存姓名、金额等明文。
const CACHE_KEY = 'giftbook_offline_cache.v1'
const QUEUE_KEY = 'giftbook_offline_queue.v1'
const CACHE_MAX_GIFTS = 800

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const data = raw ? JSON.parse(raw) : null
    return data && typeof data === 'object' ? data : { events: {}, ledgers: {} }
  } catch {
    return { events: {}, ledgers: {} }
  }
}

export function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    return true
  } catch {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ events: data.events, ledgers: {} }))
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
    const raw = localStorage.getItem(QUEUE_KEY)
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
        if (clean.length) localStorage.setItem(QUEUE_KEY, encoded)
        else localStorage.removeItem(QUEUE_KEY)
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
    if (list.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(list))
    else localStorage.removeItem(QUEUE_KEY)
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
