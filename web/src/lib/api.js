// API 客户端：统一错误分类，供离线队列判断“该重试还是该丢弃”。
let authGateHandler = () => {}
let ledgerKeyForRequest = () => ''

export function setAuthGateHandler(fn) {
  authGateHandler = fn
}

export function setLedgerKeyResolver(fn) {
  ledgerKeyForRequest = fn
}

export class ApiError extends Error {
  constructor(message, { code = 'REJECT', status = 0 } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
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
    const headers = { 'Content-Type': 'application/json' }
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

    if (response.status === 401 && !options.skipAuthRedirect) {
      authGateHandler()
      throw new ApiError('未登录或登录已过期', { code: 'UNAUTHORIZED', status: 401 })
    }

    let result = null
    try {
      result = await response.json()
    } catch {
      throw new ApiError(
        response.ok ? '响应格式异常' : `服务暂时不可用（${response.status}）`,
        { code: 'NETWORK', status: response.status },
      )
    }

    if (!result.success) {
      const transient = !response.ok && (response.status >= 500 || response.status === 408 || response.status === 429)
      let code = transient ? 'NETWORK' : response.ok ? null : 'REJECT'
      if (result.code === 'ledger_key') code = 'LEDGER_KEY'
      if (result.code === 'ledger_locked') code = 'LEDGER_LOCKED'
      throw new ApiError(result.message || '请求失败', { code: code || 'REJECT', status: response.status })
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
}
