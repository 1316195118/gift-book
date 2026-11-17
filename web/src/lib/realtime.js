// SSE 实时同步：任意设备写入后，服务端推一条 change 通知，前端防抖后重拉当前账簿。
// 只传 id/类型，礼金密文仍走 REST；断线自动重连（指数退避，最多 30s）。
import { clientId } from './client-id.js'

let source = null
let retry = 0
let retryTimer = 0
let onChange = null
let onReady = null
let connectedOnce = false

export function startRealtime(handler, readyHandler) {
  onChange = handler
  onReady = readyHandler
  if (source) return
  connect()
}

function connect() {
  if (source || !onChange) return
  try {
    source = new EventSource(`/api/stream?client=${encodeURIComponent(clientId())}`)
  } catch {
    scheduleRetry()
    return
  }
  source.addEventListener('ready', () => {
    const reconnected = connectedOnce
    connectedOnce = true
    retry = 0
    // 断线重连成功：让页面立刻补拉一次，避免错过断线期间的变更。
    if (reconnected) onReady?.()
  })
  source.addEventListener('change', (event) => {
    let payload = null
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    if (!payload || payload.actor === clientId()) return
    onChange?.(payload)
  })
  source.onerror = () => {
    source?.close()
    source = null
    scheduleRetry()
  }
}

function scheduleRetry() {
  retry = Math.min(retry + 1, 6)
  const delay = Math.min(1000 * 2 ** (retry - 1), 30000)
  clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, delay)
}

export function stopRealtime() {
  clearTimeout(retryTimer)
  source?.close()
  source = null
  retry = 0
  onChange = null
  onReady = null
  connectedOnce = false
}
