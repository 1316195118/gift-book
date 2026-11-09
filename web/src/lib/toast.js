// 右下角离线提示的轻量事件总线。
const listeners = new Set()

export const toast = {
  onRetry: null,
  show(payload) {
    listeners.forEach((fn) => fn(payload))
  },
  hide() {
    listeners.forEach((fn) => fn({ hide: true }))
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
