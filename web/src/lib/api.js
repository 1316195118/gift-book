// API 客户端：统一错误分类，供离线队列判断“该重试还是该丢弃”。
import { clientId } from './client-id.js'

let authGateHandler = () => {}
let familyGateHandler = () => {}
let ledgerKeyForRequest = () => ''

export function setAuthGateHandler(fn) {
  authGateHandler = fn
}

export function setFamilyGateHandler(fn) {
  familyGateHandler = fn
}

export function setLedgerKeyResolver(fn) {
  ledgerKeyForRequest = fn
}

export class ApiError extends Error {
  constructor(message, { code = 'REJECT', status = 0, data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    // 少数错误要靠 data 继续走流程（例如重码登录要列出候选家庭）。
    this.data = data
  }
}

const REQUEST_TIMEOUT = 15000
const RETRY_DELAY = 400

// 只把「连接层面失败」视作可重试；超时（AbortError）不重试，避免用户干等 30s。
function isNetworkFailure(error) {
  return Boolean(error && (
    error instanceof TypeError ||
    /Failed to fetch|NetworkError|Load failed/i.test(String(error.message || ''))
  ))
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function apiRequest(url, method = 'GET', data = null, options = {}) {
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Client-Id': clientId(), ...(options.headers || {}) }
    const ledgerKey = options.ledgerKey ?? ledgerKeyForRequest(url, data)
    if (ledgerKey) headers['X-Ledger-Key'] = ledgerKey

    const init = {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: data ? JSON.stringify(data) : undefined,
    }

    let response
    try {
      response = await fetchWithTimeout(url, init)
    } catch (error) {
      // 只重试幂等的 GET；写入类请求重试可能造成重复记账。
      if (method === 'GET' && options.retry !== false && isNetworkFailure(error)) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
        response = await fetchWithTimeout(url, init)
      } else {
        throw error
      }
    }

    let result = null
    try {
      result = await response.json()
    } catch {
      if (response.status === 401 && !options.skipAuthRedirect) {
        authGateHandler()
        throw new ApiError('未登录或登录已过期', { code: 'UNAUTHORIZED', status: 401 })
      }
      throw new ApiError(
        response.ok ? '响应格式异常' : `服务暂时不可用（${response.status}）`,
        { code: 'NETWORK', status: response.status },
      )
    }

    if (response.status === 401 && !options.skipAuthRedirect) {
      if (result?.code === 'family_required') {
        familyGateHandler()
        throw new ApiError(result.message || '请选择家庭并输入访问码', { code: 'FAMILY_REQUIRED', status: 401 })
      }
      authGateHandler()
      throw new ApiError('未登录或登录已过期', { code: 'UNAUTHORIZED', status: 401 })
    }

    if (!result.success) {
      const transient = !response.ok && (response.status >= 500 || response.status === 408 || response.status === 429)
      let code = transient ? 'NETWORK' : response.ok ? null : 'REJECT'
      if (result.code === 'ledger_key') code = 'LEDGER_KEY'
      if (result.code === 'ledger_locked') code = 'LEDGER_LOCKED'
      if (result.code === 'archived') code = 'ARCHIVED'
      if (result.code === 'admin_password_required') code = 'ADMIN_PASSWORD_REQUIRED'
      if (result.code === 'family_code') code = 'FAMILY_CODE'
      if (result.code === 'family_ambiguous') code = 'FAMILY_AMBIGUOUS'
      if (result.code === 'family_code_taken') code = 'FAMILY_CODE_TAKEN'
      if (result.code === 'admin_required') code = 'ADMIN_REQUIRED'
      throw new ApiError(result.message || '请求失败', { code: code || 'REJECT', status: response.status, data: result.data ?? null })
    }
    return result
  } catch (error) {
    if (error instanceof ApiError) throw error
    const message = String(error?.message || '')
    const timedOut = error?.name === 'AbortError'
    if (timedOut || error instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(message)) {
      throw new ApiError(timedOut ? '请求超时，请检查网络后重试' : '网络连接失败', { code: 'NETWORK' })
    }
    throw new ApiError(message || '请求失败', { code: 'NETWORK' })
  }
}

export const api = {
  ping: () => apiRequest('/api/ping'),

  build: () => apiRequest('/api/build'),

  capabilities: () => apiRequest('/api/capabilities'),

  authState: () =>
    fetch('/api/auth', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => ({ enabled: false, authenticated: true })),

  login: (password) => apiRequest('/api/auth', 'POST', { password }, { skipAuthRedirect: true }),

  updateAuth: (payload) => apiRequest('/api/auth', 'PUT', payload),

  logout: () => apiRequest('/api/auth', 'DELETE'),

  listEvents: () => apiRequest('/api/events'),

  getEvent: (id) => apiRequest(`/api/events/${encodeURIComponent(id)}`),

  createEvent: (payload) => apiRequest('/api/events', 'POST', payload),

  updateEvent: (id, payload) => apiRequest(`/api/events/${encodeURIComponent(id)}`, 'PUT', payload),

  deleteEvent: (id) => apiRequest(`/api/events/${encodeURIComponent(id)}`, 'DELETE'),

  verifyEvent: (id, ledgerKey) =>
    apiRequest(`/api/events/${encodeURIComponent(id)}/verify`, 'POST', { action: 'verify' }, { ledgerKey }),

  listGifts: (eventId, ledgerKey) => apiRequest(`/api/gifts?eventId=${encodeURIComponent(eventId)}`, 'GET', null, ledgerKey !== undefined ? { ledgerKey } : {}),

  createGift: (payload) => apiRequest('/api/gifts', 'POST', payload),

  updateGift: (eventId, giftId, payload) =>
    apiRequest(`/api/gifts/${encodeURIComponent(giftId)}?eventId=${encodeURIComponent(eventId)}`, 'PUT', {
      ...payload,
      eventId,
    }),

  deleteGift: (eventId, giftId) =>
    apiRequest(`/api/gifts/${encodeURIComponent(giftId)}?eventId=${encodeURIComponent(eventId)}`, 'DELETE'),

  backupInfo: () => apiRequest('/api/backup/info'),

  autobackupGet: () => apiRequest('/api/autobackup'),

  autobackupSave: (payload) => apiRequest('/api/autobackup', 'PUT', payload),

  autobackupRun: () => apiRequest('/api/autobackup/run', 'POST', {}),

  autobackupRestore: (name) => apiRequest(`/api/autobackup/restore/${encodeURIComponent(name)}`, 'POST', {}),

  autobackupDelete: (name) => apiRequest(`/api/autobackup/file/${encodeURIComponent(name)}`, 'DELETE'),

  familyMe: () => apiRequest('/api/family/me'),

  familySelfUpdate: (payload) => apiRequest('/api/family/self', 'PUT', payload),

  familyAutoBackups: () => apiRequest('/api/family/auto-backups'),

  // 家庭还原要重新验证一次访问码：服务端读 X-Family-Code，管理员登录时可留空。
  familyAutoBackupRestore: (name, accessCode = '') =>
    apiRequest(`/api/family/auto-backups/restore/${encodeURIComponent(name)}`, 'POST', {},
      accessCode ? { headers: { 'X-Family-Code': accessCode } } : {}),

  familyOverview: () => apiRequest('/api/families'),

  listFamilyArchives: () => apiRequest('/api/family/archives'),

  restoreFamilyArchive: (name) => apiRequest(`/api/family/archives/restore/${encodeURIComponent(name)}`, 'POST', {}),

  logoutAllDevices: (id) => apiRequest(`/api/families/${encodeURIComponent(id)}/logout-all`, 'POST', {}),

  auditLog: () => apiRequest('/api/audit'),

  familyLogin: (payload) => apiRequest('/api/family/login', 'POST', payload, { skipAuthRedirect: true }),

  familyLogout: () => apiRequest('/api/family/logout', 'POST', {}),

  listFamilies: () => apiRequest('/api/families'),

  createFamily: (payload) => apiRequest('/api/families', 'POST', payload),

  updateFamily: (id, payload) => apiRequest(`/api/families/${encodeURIComponent(id)}`, 'PUT', payload),

  openFamilies: () => apiRequest('/api/families/open'),

  // 删除家庭用管理员密码二次验证：401 是密码错误，不是登录过期，别弹管理员登录。
  deleteFamily: (id, payload) => apiRequest(`/api/families/${encodeURIComponent(id)}`, 'DELETE', payload, { skipAuthRedirect: true }),

  listTrash: () => apiRequest('/api/trash'),

  listSnapshots: () => apiRequest('/api/trash/snapshots'),

  restoreTrash: (name) => apiRequest(`/api/trash/restore/${encodeURIComponent(name)}`, 'POST', {}),
}
