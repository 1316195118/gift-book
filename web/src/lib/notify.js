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
    action: options.action || null,
  }
  listeners.forEach((fn) => fn({ type: 'push', item }))
  return item.id
}

export const notify = {
  success: (title, detail, options) => push('success', title, detail, options),
  info: (title, detail, options) => push('info', title, detail, options),
  warn: (title, detail, options) => push('warn', title, detail, options),
  // 带操作按钮的提示（如「撤销」）：onUndo 执行后自动关闭，只触发一次。
  undo: (title, detail, onUndo, options = {}) => push('info', title, detail, {
    ...options,
    duration: Math.max(5000, Number(options.duration) || 8000),
    action: { label: options.label || '撤销', onClick: onUndo },
  }),
  dismiss(id) {
    listeners.forEach((fn) => fn({ type: 'dismiss', id }))
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
