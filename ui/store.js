// 全局应用状态（原生 JS，零第三方依赖）：用 Proxy 在任意字段变更时触发重渲染。
import {
  LedgerCrypto, NO_PASSWORD_HASH, NO_PASSWORD_KEY, hashPassword, ledgerKeyFor,
} from './lib/crypto.js'
import { getHomeCategory, isLargeText, saveLargeText } from './lib/prefs.js'
import { readCache } from './lib/offline.js'

const listeners = new Set()
let scheduled = false
function notify() {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    listeners.forEach((fn) => {
      try { fn() } catch (err) { console.error('状态订阅回调出错:', err) }
    })
  })
}
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// 自研深度响应式（不引用 Vue 代码）：弹窗 modal、netHealth 等都是嵌套对象，
// 若只代理顶层，modal.open = true 这种修改不会通知订阅者，弹窗将永远不显示。
// Map / Set / Date / TypedArray 依赖内部插槽，套 Proxy 会让方法调用报错，原样返回。
const proxyCache = new WeakMap()
function deepReactive(value) {
  if (!value || typeof value !== 'object') return value
  if (value instanceof Map || value instanceof Set || value instanceof Date || ArrayBuffer.isView(value)) return value
  if (proxyCache.has(value)) return proxyCache.get(value)
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      return deepReactive(Reflect.get(target, key, receiver))
    },
    set(target, key, next) {
      if (target[key] === next) return true
      const ok = Reflect.set(target, key, next)
      if (ok) notify()
      return ok
    },
    deleteProperty(target, key) {
      const ok = Reflect.deleteProperty(target, key)
      if (ok) notify()
      return ok
    },
  })
  proxyCache.set(value, proxy)
  return proxy
}

const base = {
  currentEvent: null,
  currentPassword: null,
  gifts: [],
  currentPage: 1,
  cachedEvents: {},
  ledgerKeys: new Map(),
  route: 'home',
  homeCategory: getHomeCategory(),
  largeText: isLargeText(),
  locked: false,
  offlineMode: false,
  syncMessage: '',
  syncIsError: false,
  queueCount: 0,
  netHealth: { level: 'bad', text: '检测中' },
  version: '',
  build: '',
  ocrAvailable: true,
  authEnabled: false,
  authSetupRequired: false,
  authChecked: false,
  authGate: false,
  setupTemplate: null,
  modal: { open: false, title: '', size: 'default', theme: '', body: null, actions: [], token: 0, onClose: null },
}

export const state = deepReactive(base)
export const st = state

export const CATEGORY_LABEL = { red: '红事', white: '白事' }

export function setRoute(route) { state.route = route }

export function setHomeCategoryState(cat) {
  state.homeCategory = cat === 'white' ? 'white' : 'red'
}

export function setBodyTheme(themeName) {
  const theme = themeName === 'theme-solemn' ? 'theme-solemn' : 'theme-festive'
  document.body.classList.toggle('theme-solemn', theme === 'theme-solemn')
  document.body.classList.toggle('theme-festive', theme === 'theme-festive')
  document.body.dataset.theme = theme === 'theme-solemn' ? 'solemn' : 'festive'
  document.body.dataset.occasion = theme === 'theme-solemn' ? 'white' : 'red'
}

export function applyLargeText(on) {
  state.largeText = on
  // saveLargeText 同时负责切换 <html class="large-text">，此处不重复操作 DOM。
  saveLargeText(on)
}

export function rememberLedgerKey(eventId, password) {
  if (!eventId || !password) return
  state.ledgerKeys.set(String(eventId), ledgerKeyFor(password))
}

export function ledgerKeyForEvent(eventId) {
  return state.ledgerKeys.get(String(eventId)) || ''
}

export const hasLedgerKey = (eventId) => Boolean(state.ledgerKeys.get(String(eventId)))

function sessionKey() {
  try {
    let secret = sessionStorage.getItem('giftbook_session_secret')
    if (!secret) {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      sessionStorage.setItem('giftbook_session_secret', secret)
    }
    return secret
  } catch {
    return NO_PASSWORD_KEY
  }
}

export function storeSession(event, password) {
  try {
    const encryptedPassword = LedgerCrypto.encrypt(password, sessionKey())
    sessionStorage.setItem('activeEventSession', JSON.stringify({ event, encryptedPassword, savedAt: Date.now() }))
  } catch (err) {
    console.error('会话存储失败', err)
  }
}

export function touchSession() {
  try {
    const raw = sessionStorage.getItem('activeEventSession')
    if (!raw) return
    const data = JSON.parse(raw)
    data.savedAt = Date.now()
    sessionStorage.setItem('activeEventSession', JSON.stringify(data))
  } catch { /* 忽略 */ }
}

export function updateSessionEvent(event) {
  try {
    const raw = sessionStorage.getItem('activeEventSession')
    const data = raw ? JSON.parse(raw) : null
    if (data && data.event && data.event.id === event.id) {
      data.event = { ...data.event, kdf: event.kdf }
      sessionStorage.setItem('activeEventSession', JSON.stringify(data))
    }
  } catch { /* 忽略 */ }
}

export function clearSession() {
  try { sessionStorage.removeItem('activeEventSession') } catch { /* 忽略 */ }
}

export function readSession() {
  try {
    const raw = sessionStorage.getItem('activeEventSession')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function decryptSessionPassword(encryptedPassword) {
  return LedgerCrypto.decrypt(encryptedPassword, sessionKey())
}

export { hashPassword, NO_PASSWORD_KEY, NO_PASSWORD_HASH, LedgerCrypto, readCache }
