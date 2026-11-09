// 弹窗控制器（原生 JS，零第三方依赖）。body 为 { type:'html', html } 或 { type:'unlock', ... }。
import { state as st } from '../store.js'

// 直接复用 store 里的 modal 对象，变更会触发整体重渲染。
const modal = st.modal

export function openModal(title, body, actions = [], options = {}) {
  modal.token += 1
  modal.title = title || ''
  modal.body = body
  modal.actions = actions
  modal.size = options.size || 'default'
  modal.theme = options.theme || ''
  modal.onClose = options.onClose || null
  modal.open = true
  return modal.token
}

export function closeModal(immediate = false) {
  if (!modal.open) return
  modal.open = false
  if (immediate) {
    modal.body = null
    modal.actions = []
  }
}

// 弹窗进入文档后执行回调（配合整体重渲染，用双 rAF 确保 DOM 已挂载）。
export function afterModalRender(callback) {
  requestAnimationFrame(() => requestAnimationFrame(callback))
}

export function alert(title, message, callback = null) {
  openModal(
    title,
    { type: 'html', html: `<p>${message}</p>` },
    [{
      text: '确定',
      class: 'themed-button-primary px-4 py-2 rounded',
      handler: () => { if (typeof callback === 'function') callback() },
    }],
  )
}

export function confirm(title, message, onConfirm) {
  openModal(
    title,
    { type: 'html', html: `<div class="confirm-body"><div class="confirm-sub">${message}</div></div>` },
    [
      { text: '取消', class: 'modal-btn-ghost' },
      { text: '确定', class: 'modal-btn-primary', handler: onConfirm },
    ],
  )
}
