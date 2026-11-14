// 弹窗控制器：动作可以是函数，也可以是 { text, style, keepOpen, handler }。
import { reactive } from 'vue'
import { h } from 'vue'
import { escapeHtml } from './crypto.js'

export const modal = reactive({
  open: false,
  title: '',
  size: 'default',
  theme: '',
  body: null,
  actions: [],
  token: 0,
})

export function openModal(title, body, actions = [], options = {}) {
  modal.token += 1
  modal.title = title || ''
  modal.body = body
  modal.actions = actions
  modal.size = options.size || 'default'
  modal.theme = options.theme || ''
  modal.open = true
  return modal.token
}

export function closeModal(immediate = false) {
  if (!modal.open) return
  // 模板里 @click="closeModal" 会把 MouseEvent 传进来（truthy），
  // 若直接当真值用，关闭时内容会被瞬间清空、退场动画中高度塌缩。
  // 只有显式传入 true 才走「立即关闭」。
  const instant = immediate === true
  modal.open = false
  if (instant) {
    modal.body = null
    modal.actions = []
  }
}

// 弹窗内容由 Vue 异步挂载；需要操作其中 DOM 的代码用这个助手等它进入文档。
export function afterModalRender(callback) {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(callback))
  run()
}

export function alert(title, message, callback = null) {
  openModal(
    title,
    { type: 'html', html: `<p>${escapeHtml(message)}</p>` },
    [
      {
        text: '确定',
        class: 'themed-button-primary px-4 py-2 rounded',
        handler: () => {
          if (typeof callback === 'function') callback()
        },
      },
    ],
  )
}

export function confirm(title, message, onConfirm) {
  openModal(
    title,
    { type: 'html', html: `<div class="confirm-body"><div class="confirm-sub">${escapeHtml(message)}</div></div>` },
    [
      { text: '取消', class: 'modal-btn-ghost' },
      { text: '确定', class: 'modal-btn-primary', handler: onConfirm },
    ],
  )
}
