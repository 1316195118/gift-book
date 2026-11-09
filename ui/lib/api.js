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

const DEFAULT_TIMEOUT_MS = 20000

export async function apiRequest(url, method = 'GET', data = null, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const headers = {}
    const ledgerKey = options.ledgerKey ?? ledgerKeyForRequest(url, data)
    if (ledgerKey) headers['X-Ledger-Key'] = ledgerKey
    if (data) headers['Content-Type'] = 'application/json'

    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    })

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
    if (error?.name === 'AbortError' || error instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network/i.test(message)) {
      throw new ApiError('网络连接失败', { code: 'NETWORK' })
    }
    throw new ApiError(message || '请求失败', { code: 'NETWORK' })
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  ping: () => apiRequest('/api/ping'),

  build: () => apiRequest('/api/build'),

  capabilities: () => apiRequest('/api/capabilities'),

  // 访问保护状态带超时；拿不到时按离线模式继续（写请求会进离线队列），
  // 但明确标记 unknown 并留日志，不再静默假装「未开启保护且已登录」。
  authState: async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch('/api/auth', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`auth state ${response.status}`)
      return await response.json()
    } catch (error) {
      console.warn('[giftbook] 无法确认访问保护状态，按离线模式继续', error)
      return { enabled: false, authenticated: true, setupRequired: false, unknown: true }
    } finally {
      clearTimeout(timer)
    }
  },

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

  listGifts: (eventId) => apiRequest(`/api/gifts?eventId=${encodeURIComponent(eventId)}`),

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
