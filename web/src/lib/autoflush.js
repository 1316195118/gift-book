// 联网后自动补传暂存记录：网络恢复 / 页面重新可见 / 定时探测都会触发。
import { readQueue, queueFor } from './offline.js'
import { state as st } from '../store.js'
import { netState, computeHealth } from './network.js'

let flushing = false

export async function flushQueueIfOnline() {
  if (flushing || !readQueue().length) return
  if (netState.health.level === 'bad') return
  let mod
  try {
    mod = await import('./ledger-actions.js')
  } catch {
    // 旧页面引用已删除的 chunk：静默退出，下次回到前台会再试。
    return
  }
  flushing = true
  try {
    await mod.flushQueue(false)
  } finally {
    flushing = false
  }
}

export function startAutoFlush() {
  setInterval(() => {
    if (document.hidden) return
    if (computeHealth().level !== 'bad') flushQueueIfOnline()
  }, 15000)
  window.addEventListener('online', () => setTimeout(flushQueueIfOnline, 600))
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && readQueue().length) flushQueueIfOnline()
  })
}

export function pendingCount(eventId) {
  return eventId ? queueFor(eventId).length : readQueue().length
}
