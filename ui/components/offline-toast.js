// 右下角离线提示（原生 JS，零第三方依赖）。
import { toast } from '../lib/toast.js'
import { refreshNetwork } from '../lib/network.js'
import { success, warn } from '../lib/feedback.js'

let timer = null

export function mountOfflineToast(root) {
  const el = document.createElement('div')
  el.id = 'offline-toast'
  el.className = 'offline-toast hidden'
  el.setAttribute('role', 'alert')
  el.setAttribute('aria-live', 'assertive')
  el.innerHTML = `
    <button type="button" class="offline-toast-close" title="关闭提示" aria-label="关闭提示">×</button>
    <div class="offline-toast-head"><span class="offline-toast-dot" aria-hidden="true"></span><b>网络中断 · 已暂存</b></div>
    <p class="offline-toast-text"></p>
    <ul class="offline-toast-links"></ul>
    <div class="offline-toast-foot">
      <button type="button" class="offline-toast-retry">立即重试</button>
      <button type="button" class="offline-toast-ok">知道了</button>
    </div>`
  root.appendChild(el)

  const textEl = el.querySelector('.offline-toast-text')
  const linksEl = el.querySelector('.offline-toast-links')
  const retryBtn = el.querySelector('.offline-toast-retry')
  const okBtn = el.querySelector('.offline-toast-ok')
  const closeBtn = el.querySelector('.offline-toast-close')

  const hide = () => {
    el.classList.add('hidden')
    clearTimeout(timer)
  }

  retryBtn.addEventListener('click', async () => {
    retryBtn.disabled = true
    retryBtn.textContent = '重试中…'
    try {
      const health = await refreshNetwork()
      if (typeof toast.onRetry === 'function') await toast.onRetry()
      hide()
      if (health && health.level !== 'bad') success('网络已恢复，待同步记录已补传')
      else warn('仍未连接上服务器，记录继续留在本机')
    } finally {
      retryBtn.disabled = false
      retryBtn.textContent = '立即重试'
    }
  })
  okBtn.addEventListener('click', hide)
  closeBtn.addEventListener('click', hide)

  toast.subscribe((payload) => {
    if (!payload || payload.hide) {
      hide()
      return
    }
    textEl.innerHTML = payload.text || ''
    linksEl.innerHTML = (payload.links || [])
      .map((l) => `<li class="${l.ok ? 'ok' : 'bad'}">${l.label} · ${l.ok ? `${l.ms} ms` : '断开'}</li>`)
      .join('')
    el.classList.remove('hidden')
    clearTimeout(timer)
    timer = setTimeout(hide, 15000)
  })
}
