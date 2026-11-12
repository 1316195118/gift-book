// 全局应用状态：字典顺序与旧版单文件里的状态变量一一对应，便于对照移植。
import { reactive } from 'vue'
import {
  NO_PASSWORD_HASH, NO_PASSWORD_KEY, LedgerCrypto, hashPassword, ledgerKeyFor,
} from './lib/crypto.js'
import { getHomeCategory, isLargeText, saveLargeText } from './lib/prefs.js'
import { readCache } from './lib/offline.js'

export const state = reactive({
  // 数据
  currentEvent: null,
  currentPassword: null,
  gifts: [],
  currentPage: 1,
  cachedEvents: {},
  ledgerKeys: new Map(),

  // 界面
  route: 'home', // home | template | setup | main
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

  // 认证
  authEnabled: false,
  authSetupRequired: false,
  authChecked: false,
  authGate: false,

  // 弹窗
  modal: { open: false, title: '', size: 'default', theme: '', content: null, actions: [] },
})

export const st = state

export const CATEGORY_LABEL = { red: '红事', white: '白事' }

const ROUTE_DEPTH = { home: 0, template: 1, setup: 2, main: 3 }
let themeTimer = null

export function setRoute(route) {
  const from = state.route
  const deeper = (ROUTE_DEPTH[route] ?? 0) >= (ROUTE_DEPTH[from] ?? 0)
  // 供 CSS 选择入场方向：往里走从右进、返回从左回、进账簿是翻页。
  document.documentElement.dataset.viewDirection = route === 'main' ? 'book' : (deeper ? 'forward' : 'back')
  state.route = route
}

export function setHomeCategoryState(cat) {
  state.homeCategory = cat === 'white' ? 'white' : 'red'
}

export function setBodyTheme(themeName) {
  const theme = themeName === 'theme-solemn' ? 'theme-solemn' : 'theme-festive'
  const changed = !document.body.classList.contains(theme)
  document.body.classList.toggle('theme-solemn', theme === 'theme-solemn')
  document.body.classList.toggle('theme-festive', theme === 'theme-festive')
  document.body.dataset.theme = theme === 'theme-solemn' ? 'solemn' : 'festive'
  document.body.dataset.occasion = theme === 'theme-solemn' ? 'white' : 'red'
  if (changed) {
    document.documentElement.classList.add('theme-shifting')
    clearTimeout(themeTimer)
    themeTimer = setTimeout(() => document.documentElement.classList.remove('theme-shifting'), 460)
  }
}

export function applyLargeText(on) {
  state.largeText = on
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

// 会话恢复：每个标签页独立密钥，10 分钟内刷新可回到原账簿。
const sessionKey = () => {
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
    sessionStorage.setItem(
      'activeEventSession',
      JSON.stringify({ event, encryptedPassword, savedAt: Date.now() }),
    )
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
  } catch {
    /* 忽略 */
  }
}

export function updateSessionEvent(event) {
  try {
    const raw = sessionStorage.getItem('activeEventSession')
    const data = raw ? JSON.parse(raw) : null
    if (data && data.event && data.event.id === event.id) {
      data.event = { ...data.event, kdf: event.kdf }
      sessionStorage.setItem('activeEventSession', JSON.stringify(data))
    }
  } catch {
    /* 忽略 */
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem('activeEventSession')
  } catch {
    /* 忽略 */
  }
}

export function readSession() {
  try {
    const raw = sessionStorage.getItem('activeEventSession')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function decryptSessionPassword(encryptedPassword) {
  return LedgerCrypto.decrypt(encryptedPassword, sessionKey())
}

export { hashPassword, NO_PASSWORD_KEY, NO_PASSWORD_HASH, LedgerCrypto, readCache }
