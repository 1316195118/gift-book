// 应用启动与跨页面动作。
import {
  state as st, setRoute, setHomeCategoryState, rememberLedgerKey, setBodyTheme,
  storeSession, readSession, decryptSessionPassword, clearSession, updateSessionEvent,
  NO_PASSWORD_KEY, NO_PASSWORD_HASH, LedgerCrypto,
} from './store.js'
import { api, setAuthGateHandler, setFamilyGateHandler, setLedgerKeyResolver, ApiError } from './lib/api.js'
import { cacheEventList, readCache, queueFor, cacheLedgerGifts, cacheLedgerVerifier, setCacheFamily } from './lib/offline.js'
import { categoryForEvent, eventTheme, isSolemnEvent } from './lib/content.js'
import { getHomeCategory, setHomeCategory, readLocked, isLargeText, saveLargeText } from './lib/prefs.js'
import { ledgerKeyForEvent } from './store.js'
import { startNetworkMonitor } from './lib/network.js'
import { openModal, closeModal, alert as showAlert, confirm as showConfirm } from './lib/modal.js'
import { compareGiftsByRegistration } from './lib/gift-order.js'
import { itemsPerPage } from './lib/page-size.js'
import { clearRecentEntry } from './lib/recent-entry.js'
import { resetExportScope } from './lib/export-scope.js'

setAuthGateHandler(() => {
  st.authGate = true
})
setFamilyGateHandler(() => {
  st.familyGate = true
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
  // 认证/家庭校验完成前先占住列表区域，避免首页短暂闪出「还没有账簿」。
  if (!st.eventsLoaded) st.eventsLoading = true
  startNetworkMonitor()
  refreshBuildInfo()
  // 认证状态与家庭会话互不依赖：同时发出，只按界面需要的顺序应用结果。
  const familyRequest = api.familyMe()
    .then((me) => ({ me }))
    .catch((error) => ({ error }))
  if (!skipAuth) {
    const auth = await api.authState()
    st.authEnabled = Boolean(auth.enabled)
    st.authSetupRequired = Boolean(auth.setupRequired)
    st.multiFamily = Boolean(auth.multiFamily)
    st.authChecked = true
    // 管理员密码只作为管理员入口，不再作为全站门禁；
    // 普通家庭成员直接走家庭门，只有点「管理员登录」时才打开 AuthGate。
  }
  st.authGate = false
  // 家庭门：没有合法家庭会话时停在这里，输入访问码后再继续加载账簿。
  try {
    const result = await familyRequest
    if (result.error) throw result.error
    const me = result.me
    st.family = me.data || null
    st.familyGate = false
    // 离线缓存与待补传队列按家庭分键，避免换家庭后读到上一家的数据。
    setCacheFamily(st.family?.id)
    // 有本机列表时先秒开首页，再让网络请求在后台刷新。
    const cachedEvents = readCache().events || {}
    if (Object.keys(cachedEvents).length) {
      st.cachedEvents = cachedEvents
      st.eventsLoaded = true
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'FAMILY_REQUIRED') {
      st.familyGate = true
      setCacheFamily('')
      return
    }
    // 网络异常不阻塞单家庭部署；后续请求会再次触发家庭门。
  }
  if (!restoreSession()) {
    await loadEvents()
    showHome({ reload: false })
  } else {
    st.eventsLoading = false
  }
}

export async function refreshBuildInfo() {
  // 版本与能力是两件事：build.json 命中只说明拿到了构建号，
  // 不能因此跳过 /api/capabilities，否则 OCR 这类按能力隐藏的入口会一直按默认值显示。
  // build.json 与能力接口并行，较慢的一项不再额外叠加网络往返。
  const capsRequest = api.capabilities()
    .then((caps) => {
      if (typeof caps.data?.ocr === 'boolean') st.ocrAvailable = caps.data.ocr
    })
    .catch(() => {
      /* 忽略：能力探测失败时保留默认值，避免误藏可用功能 */
    })
  let gotBuild = false
  try {
    const res = await fetch('build.json', { cache: 'no-store' }).catch(() => null)
    if (res && res.ok) {
      const info = await res.json()
      st.build = info.build || ''
      st.version = info.version || ''
      gotBuild = Boolean(st.build || st.version)
    }
  } catch {
    /* 忽略：退回服务端接口 */
  }
  if (!gotBuild) {
    try {
      const info = await api.build()
      st.build = info.data?.build || ''
      st.version = info.data?.version || ''
    } catch {
      /* 忽略 */
    }
  }
  await capsRequest
}

// ---- 页面切换 ----

export function showHome({ reload = true } = {}) {
  document.body.classList.remove('ledger-closed', 'ledger-closed-solemn')
  clearSession()
  st.currentEvent = null
  st.currentPassword = null
  st.gifts = []
  st.currentPage = 1
  setHomeCategoryState(getHomeCategory())
  setRoute('home')
  setBodyTheme(getHomeCategory() === 'white' ? 'theme-solemn' : 'theme-festive')
  if (reload) loadEvents()
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

let eventsRequest = null

export function loadEvents() {
  // 分类切换、返回首页和启动流程可能同一时刻触刷新；合并成一个请求。
  if (eventsRequest) return eventsRequest
  st.eventsLoading = true
  eventsRequest = (async () => {
    try {
      const result = await api.listEvents()
      st.cachedEvents = result.data || {}
      cacheEventList(st.cachedEvents)
      st.offlineMode = false
      st.eventsLoaded = true
      return st.cachedEvents
    } catch (error) {
      const cached = readCache().events || {}
      if (error instanceof ApiError && error.code === 'NETWORK' && Object.keys(cached).length) {
        st.cachedEvents = cached
        st.offlineMode = true
        st.syncMessage = '当前连不上服务器，显示的是本机缓存的账簿；新录入会暂存，联网后自动补传。'
        st.syncIsError = true
        st.eventsLoaded = true
        return cached
      }
      if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return {}
      showAlert('错误', '无法加载事项列表。')
      return {}
    } finally {
      st.eventsLoading = false
      st.eventsLoaded = true
    }
  })()
  return eventsRequest.finally(() => {
    eventsRequest = null
  })
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
  const { event, encryptedPassword, familyId, savedAt } = saved
  if (!event || !encryptedPassword) {
    clearSession()
    return false
  }
  // 会话必须属于当前家庭：换家庭后旧账簿不能在这里被恢复出来。
  if (!familyId || familyId !== st.family?.id) {
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
  // 换账簿时清掉上一本的回执与导出勾选，避免把 A 簿的选择带到 B 簿。
  clearRecentEntry()
  resetExportScope()
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
  st.giftsLoaded = false
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
    const decryptedBatch = encryptedGifts.slice(0)
    const batchSize = 50
    for (let i = 0; i < encryptedGifts.length; i += batchSize) {
      const batch = encryptedGifts.slice(i, i + batchSize)
      decrypted.push(
        ...batch
          .map((g) => {
            const cacheKey = `${g.id}:${g.updatedAt || g.createdAt || ''}:${String(password || '')}`
            let data = decryptCache.get(cacheKey)
            if (data === undefined) {
              data = decryptData(g.encryptedContent, password, cipher)
              if (decryptCache.size > 4000) decryptCache.clear()
              decryptCache.set(cacheKey, data ?? null)
            }
            return data ? { ...g, data } : null
          })
          .filter((g) => g !== null),
      )
      if (i + batchSize < encryptedGifts.length) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (generation !== loadGeneration || st.currentEvent?.id !== eventId) return
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
    // 时间戳在密文里，只有解开之后才排得了；修改记录不会改变登记顺序。
    st.gifts = decrypted.concat(pending).sort(compareGiftsByRegistration)
    st.giftsLoaded = true
    st.currentPage = Math.ceil(st.gifts.length / itemsPerPage()) || 1
    st.queueCount = pending.length
    const unreadable = encryptedGifts.length - decrypted.length
    if (unreadable > 0) {
      setSyncStatus(`有 ${unreadable} 条记录暂时无法解密，未显示也未计入总额；请刷新或重新解锁后再试。`, true)
    } else if (fromCache) {
      st.offlineMode = true
      setSyncStatus(`当前离线，显示的是本机缓存的 ${decrypted.length} 条记录；新录入会暂存，联网后自动补传。`, true)
    } else {
      setSyncStatus('')
      cacheLedgerGifts(eventId, encryptedGifts)
      syncEventTotal()
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHORIZED') return
    if (generation === loadGeneration) setSyncStatus('账簿数据加载失败，请检查网络后重试。', true)
    st.giftsLoaded = true
  }
}

export function setSyncStatus(message, isError = false) {
  st.syncMessage = message || ''
  st.syncIsError = Boolean(isError) && Boolean(message)
}

// ---- 加密上下文 ----

let currentCipher = null
let cipherPending = null

// 密钥会话缓存：纯 JS PBKDF2 在 31 万次迭代下要数秒到十几秒（手机上更久），
// 同一标签页内切账簿、刷新页面不该每次都重算。只按「账簿 + 密码指纹」存密钥本体，
// 换密码或换账簿自然失效；关掉页面即清空（sessionStorage）。
const CIPHER_CACHE_PREFIX = 'gb-cipher-'

// 只存密码的 sha256 指纹用于比对，缓存里不放明文密码。
const cipherFingerprint = (password) => LedgerCrypto.sha256(String(password ?? ''))

function readCipherCache(eventId, password) {
  try {
    const raw = sessionStorage.getItem(CIPHER_CACHE_PREFIX + eventId)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (entry.fp !== cipherFingerprint(password)) return null
    if (!entry.enc || !entry.mac) return null
    return {
      v: 2,
      password,
      enc: Uint8Array.from(atob(entry.enc), (c) => c.charCodeAt(0)),
      mac: Uint8Array.from(atob(entry.mac), (c) => c.charCodeAt(0)),
    }
  } catch {
    return null
  }
}

function writeCipherCache(eventId, password, keys) {
  try {
    const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
    sessionStorage.setItem(CIPHER_CACHE_PREFIX + eventId, JSON.stringify({
      fp: cipherFingerprint(password),
      enc: b64(keys.enc),
      mac: b64(keys.mac),
    }))
  } catch {
    // 隐私模式或配额满：忽略，退化为每次重新派生。
  }
}

export function clearCipherCache(eventId) {
  try {
    if (eventId) sessionStorage.removeItem(CIPHER_CACHE_PREFIX + eventId)
    else Object.keys(sessionStorage).filter((k) => k.startsWith(CIPHER_CACHE_PREFIX)).forEach((k) => sessionStorage.removeItem(k))
  } catch {
    // ignore
  }
}

export function resetCipher() {
  currentCipher = null
  cipherPending = null
}

const cipherFor = (password) =>
  currentCipher && st.currentEvent && currentCipher.eventId === st.currentEvent.id && currentCipher.password === password
    ? currentCipher.keys
    : password

// 解密结果缓存：礼金记录不变时直接复用解析结果，翻页/远端刷新不用重复解密。
// 键 = 记录ID + 更新时间 + 口令，口令变化或记录更新都会自然失效。
const decryptCache = new Map()

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
    // 先查会话缓存：命中就跳过 PBKDF2，切换账簿基本瞬时。
    let keys = readCipherCache(event.id, password)
    if (!keys) {
      setSyncStatus('正在准备加密密钥…', false)
      // 让浏览器先把「正在准备」画出来，再进入可能持续数秒的派生计算。
      await new Promise((resolve) => setTimeout(resolve, 30))
      try {
        // 纯 JS 派生要数秒到十几秒，把进度显示出来，避免用户以为卡死。
        let lastShown = -10
        keys = await LedgerCrypto.deriveKeysAsync(password, params, (ratio) => {
          const pct = Math.min(99, Math.round(ratio * 100))
          if (pct - lastShown < 10) return
          lastShown = pct
          setSyncStatus(`正在准备加密密钥 ${pct}%…`, false)
        })
      } catch (error) {
        console.error('密钥派生失败', error)
        return null
      } finally {
        setSyncStatus('')
      }
      writeCipherCache(event.id, password, keys)
    }
    if (!st.currentEvent || st.currentEvent.id !== event.id || st.currentPassword !== password) return null
    currentCipher = { eventId: event.id, password, keys }
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
