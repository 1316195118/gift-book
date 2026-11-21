// 弹窗控制器：动作可以是函数，也可以是 { text, style, keepOpen, handler }。
import { reactive } from 'vue'
import { escapeHtml } from './crypto.js'

// 提示 / 确认弹窗统一按纯文本转义后再渲染；只把换行转成 <br>。
// 调用方不要再手写 HTML 标签，否则会被转义成可见的标签源码。
function messageHtml(message) {
  return escapeHtml(String(message ?? '')).replace(/\r?\n/g, '<br>')
}

export const modal = reactive({
  open: false,
  title: '',
  size: 'default',
  theme: '',
  body: null,
  actions: [],
  token: 0,
  // 是否允许点遮罩关闭：提示/确认类为 true，密码与表单类保持 false 防误关。
  dismissable: false,
})

export function openModal(title, body, actions = [], options = {}) {
  modal.token += 1
  modal.title = title || ''
  modal.body = body
  modal.actions = actions
  modal.size = options.size || 'default'
  modal.theme = options.theme || ''
  modal.dismissable = options.dismissable === true
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

// 弹窗按钮的默认语义是「先离开当前弹窗，再执行动作」。这样慢网络、加密或文件
// 生成都不会把菜单留在屏幕上；需要保留弹窗显示进度的动作显式设置 keepOpen。
export async function runModalAction(action) {
  // 表单类弹窗在关闭前还需要读取用户刚输入的值。beforeClose 必须同步执行，
  // 否则 DOM 已进入退场或卸载后，读到的备注等字段会变成空值。
  if (typeof action.beforeClose === 'function') {
    try {
      action.beforeClose()
    } catch (error) {
      console.error('弹窗关闭前取值失败', error)
    }
  }
  if (!action.keepOpen) {
    closeModal()
    // 只有状态改变还不够：动作处理器若同步做重活，浏览器会等它结束后才绘制。
    // 把非关键动作排到关闭帧之后，确认框和菜单就能先离开屏幕。
    await afterModalPaint()
  }
  if (typeof action.handler === 'function') return action.handler()
}

function afterModalPaint() {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    // 两次 RAF 保证关闭状态已提交到一帧；后台标签页不派发 RAF 时用定时器兜底。
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(done))
    }
    setTimeout(done, 50)
  })
}

// 弹窗内容由 Vue 异步挂载；需要操作其中 DOM 的代码用这个助手等它进入文档。
export function afterModalRender(callback) {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(callback))
  run()
}

export function alert(title, message, callback = null) {
  openModal(
    title,
    { type: 'html', html: `<p>${messageHtml(message)}</p>` },
    [
      {
        text: '确定',
        class: 'themed-button-primary px-4 py-2 rounded',
        handler: () => {
          if (typeof callback === 'function') callback()
        },
      },
    ],
    { dismissable: true },
  )
}

export function confirm(title, message, onConfirm) {
  openModal(
    title,
    { type: 'html', html: `<div class="confirm-body"><div class="confirm-sub">${messageHtml(message)}</div></div>` },
    [
      { text: '取消', class: 'modal-btn-ghost' },
      { text: '确定', class: 'modal-btn-primary', handler: onConfirm },
    ],
    { dismissable: true },
  )
}
