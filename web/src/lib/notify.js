// 轻量操作反馈总线：成功 / 信息 / 警告走 toast，错误仍用弹窗（更醒目）。
// 与 toast.js（离线提示）互不干扰。
const listeners = new Set()
let seq = 0

function push(type, title, detail = '', options = {}) {
  const item = {
    id: ++seq,
    type,
    title: String(title),
    detail: String(detail || ''),
    duration: Math.max(1500, Number(options.duration) || 3600),
    paused: false,
  }
  listeners.forEach((fn) => fn({ type: 'push', item }))
  return item.id
}

export const notify = {
  success: (title, detail, options) => push('success', title, detail, options),
  info: (title, detail, options) => push('info', title, detail, options),
  warn: (title, detail, options) => push('warn', title, detail, options),
  dismiss(id) {
    listeners.forEach((fn) => fn({ type: 'dismiss', id }))
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
