// 应用启动与跨页面动作。原生 JS（零第三方依赖）。
import {
  state as st, setRoute, setHomeCategoryState, rememberLedgerKey, setBodyTheme,
  storeSession, readSession, decryptSessionPassword, clearSession, updateSessionEvent,
  NO_PASSWORD_KEY, NO_PASSWORD_HASH, LedgerCrypto,
} from './store.js'
import { api, setAuthGateHandler, setLedgerKeyResolver, ApiError } from './lib/api.js'
import { cacheEventList, readCache } from './lib/offline.js'
import { categoryForEvent, eventTheme, isSolemnEvent } from './lib/content.js'
import { getHomeCategory, setHomeCategory, readLocked, isLargeText, saveLargeText } from './lib/prefs.js'
import { ledgerKeyForEvent } from './store.js'
import { refreshNetwork, startNetworkMonitor } from './lib/network.js'
import { openModal, closeModal, alert as showAlert, confirm as showConfirm } from './lib/modal.js'

setAuthGateHandler(() => {
  st.authGate = true
})
// 账簿钥匙按「请求里出现的账簿」解析：REST 路径、查询串、请求体三种来源都要认。
// POST /api/gifts 只在请求体里带 eventId，漏掉它就会写成 403。
setLedgerKeyResolver((url, data) => {
  const pathId = /\/api\/events\/([^/?]+)/.exec(url)
  if (pathId) return ledgerKeyForEvent(decodeURIComponent(pathId[1]))
  const queryId = /[?&]eventId=([^&]+)/.exec(url)
  if (queryId) return ledgerKeyForEvent(decodeURIComponent(queryId[1]))
  if (data && typeof data === 'object' && data.eventId) return ledgerKeyForEvent(String(data.eventId))
  return ''
})

let booted = false

export async function bootstrap({ skipAuth = false } = {}) {
  if (skipAuth) {
    st.authChecked = true
  } else if (booted) {
    return
  }
  booted = true
  saveLargeText(isLargeText())
  startNetworkMonitor()
  refreshBuildInfo()
  if (!skipAuth) {
    const auth = await api.authState()
    st.authEnabled = Boolean(auth.enabled)
    st.authSetupRequired = Boolean(auth.setupRequired)
    st.authChecked = true
    if (auth.enabled && !auth.authenticated) {
      st.authGate = true
      return
    }
  }
  st.authGate = false
  if (!restoreSession()) {
    await loadEvents()
    showHome()
  }
}

export async function refreshBuildInfo() {
  try {
    const res = await fetch('build.json', { cache: 'no-store' }).catch(() => null)
    if (res && res.ok) {
      const info = await res.json()
      st.build = info.build || ''
      st.version = info.version || ''
      return
    }
  } catch {
    /* 忽略 */
  }
  try {
    const info = await api.build()
    st.build = info.data?.build || ''
    st.version = info.data?.version || ''
  } catch {
    /* 忽略 */
  }
  try {
    const caps = await api.capabilities()
    if (typeof caps.data?.ocr === 'boolean') st.ocrAvailable = caps.data.ocr
  } catch {
    /* 忽略：能力探测失败时保留默认值，避免误藏可用功能 */
  }
}

// ---- 页面切换 ----

export function showHome() {
  document.body.classList.remove('ledger-closed', 'ledger-closed-solemn')
  clearSession()
  st.currentEvent = null
  st.currentPassword = null
  st.gifts = []
  st.currentPage = 1
  setHomeCategoryState(getHomeCategory())
  setRoute('home')
  setBodyTheme(getHomeCategory() === 'white' ? 'theme-solemn' : 'theme-festive')
  loadEvents()
}

export function showTemplates(category) {
  if (category) {
    setHomeCategory(category)
    setHomeCategoryState(category)
  }
  setRoute('template')
  setBodyTheme(getHomeCategory() === 'white' ? 'theme-solemn' : 'theme-festive')
}

export function showSetup({ template = null } = {}) {
  st.currentEvent = null
  st.currentPassword = null
  st.gifts = []
  clearSession()
  st.setupTemplate = template
  setRoute('setup')
  setBodyTheme(getHomeCategory() === 'white' ? 'theme-solemn' : 'theme-festive')
  loadEvents()
}

// ---- 账簿列表 ----

export async function loadEvents() {
  try {
    const result = await api.listEvents()
    st.cachedEvents = result.data || {}
    cacheEventList(st.cachedEvents)
    st.offlineMode = false
    return st.cachedEvents
  } catch (error) {
    const cached = readCache().events || {}
    if (error instanceof ApiError && error.code === 'NETWORK' && Object.keys(cached).length) {
      st.cachedEvents = cached
      st.offlineMode = true
      st.syncMessage = '当前连不上服务器，显示的是本机缓存的账簿；新录入会暂存，联网后自动补传。'
      st.syncIsError = true
      return cached
    }
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return {}
    showAlert('错误', '无法加载事项列表。')
    return {}
  }
}

export function isClosedEvent(ev) {
  const end = ev && ev.endDateTime ? new Date(ev.endDateTime).getTime() : NaN
  return Number.isFinite(end) && Date.now() > end
}

export function isBeforeStart(ev) {
  const start = ev && ev.startDateTime ? new Date(ev.startDateTime).getTime() : NaN
  return Number.isFinite(start) && Date.now() < start
}

// ---- 会话 ----

function restoreSession() {
  const saved = readSession()
  if (!saved) return false
  const { event, encryptedPassword, savedAt } = saved
  if (!event || !encryptedPassword) {
    clearSession()
    return false
  }
  if (!savedAt || Date.now() - Number(savedAt) > 10 * 60 * 1000) {
    clearSession()
    return false
  }
  const kind = categoryForEvent(event, getHomeCategory())
  if (getHomeCategory() !== kind) {
    clearSession()
    return false
  }
  if (kind === 'white' && isBeforeStart(event)) {
    setHomeCategory('white')
    setHomeCategoryState('white')
    clearSession()
    return false
  }
  const endAt = event.endDateTime ? new Date(event.endDateTime).getTime() : NaN
  if (!Number.isFinite(endAt) || Date.now() > endAt) {
    clearSession()
    return false
  }
  const password = decryptSessionPassword(encryptedPassword)
  if (!password) {
    clearSession()
    return false
  }
  st.currentEvent = event
  st.currentPassword = password
  startSession()
  return true
}

export function startSession() {
  const event = st.currentEvent
  if (!event) return
  setHomeCategory(categoryForEvent(event, st.homeCategory))
  setHomeCategoryState(categoryForEvent(event, st.homeCategory))
  rememberLedgerKey(event.id, st.currentPassword)
  setBodyTheme(eventTheme(event, st.homeCategory))
  st.locked = readLocked(event.id)
  setRoute('main')
  storeSession(event, st.currentPassword)
  loadGiftsForCurrentEvent()
  window.scrollTo(0, 0)
}

export function endSession() {
  clearSession()
  st.currentEvent = null
  st.currentPassword = null
  st.gifts = []
  st.currentPage = 1
}

// ---- 礼金加载 ----

let loadGeneration = 0

export async function loadGiftsForCurrentEvent() {
  const event = st.currentEvent
  const password = st.currentPassword
  if (!event || !password) return
  const eventId = event.id
  const generation = ++loadGeneration
  const cipher = (await ensureCipher())?.keys || null
  if (generation !== loadGeneration || st.currentEvent?.id !== eventId) return
  try {
    let fromCache = false
    let encryptedGifts
    try {
      const result = await api.listGifts(eventId)
      encryptedGifts = Object.values(result.data || {})
      st.offlineMode = false
    } catch (error) {
      const entry = readCache().ledgers?.[eventId]
      if (!(error instanceof ApiError && error.code === 'NETWORK' && entry && Array.isArray(entry.gifts))) throw error
      encryptedGifts = entry.gifts
      fromCache = true
    }
    if (generation !== loadGeneration || st.currentEvent?.id !== eventId) return
    const decrypted = []
    const batchSize = 50
    for (let i = 0; i < encryptedGifts.length; i += batchSize) {
      const batch = encryptedGifts.slice(i, i + batchSize)
      decrypted.push(
        ...batch
          .map((g) => ({ ...g, data: decryptData(g.encryptedContent, password, cipher) }))
          .filter((g) => g.data !== null),
      )
      if (i + batchSize < encryptedGifts.length) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (generation !== loadGeneration || st.currentEvent?.id !== eventId) return
    const { queueFor } = await import('./lib/offline.js')
    const pending = queueFor(eventId)
      .map((item) => ({
        id: item.qid,
        eventId,
        encryptedContent: item.encryptedContent,
        pending: true,
        data: decryptData(item.encryptedContent, password, cipher),
      }))
      .filter((g) => g.data)
    // 礼簿按登记先后排，不能按 ID 排：礼金 ID 是随机十六进制，
    // 服务端的 sort.Strings 等于打乱顺序，印出来的簿子会前后错乱。
    // 时间戳在密文里，只有解开之后才排得了。
    st.gifts = decrypted.concat(pending).sort((a, b) => {
      const ta = Date.parse(a.data?.timestamp ?? '')
      const tb = Date.parse(b.data?.timestamp ?? '')
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
      if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1
      return String(a.id ?? '').localeCompare(String(b.id ?? ''))
    })
    st.currentPage = Math.ceil(st.gifts.length / 12) || 1
    st.queueCount = pending.length
    const unreadable = encryptedGifts.length - decrypted.length
    if (unreadable > 0) {
      setSyncStatus(`有 ${unreadable} 条记录暂时无法解密，未显示也未计入总额；请刷新或重新解锁后再试。`, true)
    } else if (fromCache) {
      st.offlineMode = true
      setSyncStatus(`当前离线，显示的是本机缓存的 ${decrypted.length} 条记录；新录入会暂存，联网后自动补传。`, true)
    } else {
      setSyncStatus('')
      const { cacheLedgerGifts } = await import('./lib/offline.js')
      cacheLedgerGifts(eventId, encryptedGifts)
      syncEventTotal()
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return
    if (generation === loadGeneration) setSyncStatus('账簿数据加载失败，请检查网络后重试。', true)
  }
}

export function setSyncStatus(message, isError = false) {
  st.syncMessage = message || ''
  st.syncIsError = Boolean(isError) && Boolean(message)
}

// ---- 加密上下文 ----

let currentCipher = null
let cipherPending = null

export function resetCipher() {
  currentCipher = null
  cipherPending = null
}

const cipherFor = (password) =>
  currentCipher && st.currentEvent && currentCipher.eventId === st.currentEvent.id && currentCipher.password === password
    ? currentCipher.keys
    : password

export const encryptData = (data, key) => LedgerCrypto.encrypt(JSON.stringify(data), cipherFor(key))

export function decryptData(ciphertext, key, cipherOverride = null) {
  try {
    const plain = LedgerCrypto.decrypt(ciphertext, cipherOverride || cipherFor(key))
    if (plain == null) return null
    return JSON.parse(plain)
  } catch (error) {
    console.error('解密失败:', error)
    return null
  }
}

export async function ensureCipher() {
  const event = st.currentEvent
  const password = st.currentPassword
  if (!event || !password || !event.hasPassword) return null
  if (currentCipher && currentCipher.eventId === event.id && currentCipher.password === password) return currentCipher
  if (cipherPending && cipherPending.eventId === event.id && cipherPending.password === password) return cipherPending.promise
  const promise = (async () => {
    let params = event.kdf
    if (!params) {
      try {
        const result = await api.updateEvent(event.id, { kdf: LedgerCrypto.newKdfParams() })
        params = result.data?.kdf
      } catch (error) {
        console.warn('暂时无法升级加密参数，继续使用旧格式', error)
        return null
      }
      if (!params) return null
      event.kdf = params
      if (st.currentEvent && st.currentEvent.id === event.id) st.currentEvent.kdf = params
      updateSessionEvent(event)
    }
    setSyncStatus('正在准备加密密钥…', false)
    await new Promise((resolve) => setTimeout(resolve, 30))
    let keys
    try {
      keys = LedgerCrypto.deriveKeys(password, params)
    } catch (error) {
      console.error('密钥派生失败', error)
      return null
    } finally {
      setSyncStatus('')
    }
    if (!st.currentEvent || st.currentEvent.id !== event.id || st.currentPassword !== password) return null
    currentCipher = { eventId: event.id, password, keys }
    const { cacheLedgerVerifier } = await import('./lib/offline.js')
    cacheLedgerVerifier(event.id, LedgerCrypto.hmacSha256Hex2(keys.mac, 'giftbook-offline-verify'))
    return currentCipher
  })()
  cipherPending = { eventId: event.id, password, promise }
  try {
    return await promise
  } finally {
    if (cipherPending && cipherPending.promise === promise) cipherPending = null
  }
}

// ---- 总额同步 ----

let syncRetryTimer = null

export async function syncEventTotal() {
  const event = st.currentEvent
  if (!event) return
  const eventId = event.id
  const total = st.gifts.filter((g) => !g.pending).reduce((sum, g) => sum + (Number(g.data?.amount) || 0), 0)
  if (Number(event.totalAmount) === total) {
    setSyncStatus('')
    return
  }
  const previous = event.totalAmount
  event.totalAmount = total
  try {
    await api.updateEvent(eventId, { totalAmount: total })
    if (st.currentEvent?.id === eventId) setSyncStatus('')
    clearTimeout(syncRetryTimer)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return
    if (st.currentEvent?.id === eventId) {
      event.totalAmount = previous
      setSyncStatus('总额暂未同步到 NAS，请检查网络后重试。', true)
      clearTimeout(syncRetryTimer)
      syncRetryTimer = setTimeout(() => {
        if (st.currentEvent?.id === eventId) syncEventTotal()
      }, 15000)
    }
  }
}

export { openModal, closeModal, showAlert, showConfirm, isSolemnEvent }
