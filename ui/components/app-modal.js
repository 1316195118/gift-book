// 弹窗：渲染 st.modal，支持 html / unlock / export / component 四种内容。
import { state as st, subscribe } from '../store.js'
import { closeModal, alert as showAlert } from '../lib/modal.js'
import { escapeHtml } from '../lib/crypto.js'
import { info } from '../lib/feedback.js'

let activeComponent = null
let lastToken = -1
let lastOpen = null

function sizeClass(size) {
  if (size === 'large') return 'modal-large'
  if (size === 'unlock') return 'modal-unlock'
  return ''
}

function renderContent(contentEl, body) {
  if (activeComponent && activeComponent.destroy) {
    try { activeComponent.destroy() } catch { /* 忽略 */ }
    activeComponent = null
  }
  const type = body && body.type
  if (type === 'unlock') {
    contentEl.innerHTML = unlockMarkup(body)
    const form = contentEl.querySelector('#unlock-form')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submitUnlock(body)
    })
  } else if (type === 'export') {
    contentEl.innerHTML = exportMarkup(body)
    contentEl.querySelectorAll('[data-export-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-export-format')
        const labels = { excel: 'Excel 表格', pdf: 'PDF 礼簿', word: 'Word 文档' }
        closeModal()
        info(`正在生成${labels[fmt] || '文件'}…`, { duration: 1800 })
        if (body.onPick) body.onPick(fmt)
      })
    })
  } else if (type === 'component') {
    const component = body.component
    if (component && typeof component.render === 'function') {
      contentEl.innerHTML = component.render(body.props || {})
      if (typeof component.mount === 'function') {
        activeComponent = component
        component.mount.call(component, contentEl, body.props || {})
      }
    } else {
      contentEl.innerHTML = ''
    }
  } else {
    contentEl.innerHTML = (body && body.html) || ''
  }
}

function unlockMarkup(body) {
  return `
    <div class="unlock-card">
      <button type="button" class="unlock-close" aria-label="关闭" id="unlock-close">×</button>
      <div class="unlock-seal" aria-hidden="true">礼</div>
      <h3 class="unlock-title">进入账簿</h3>
      <p class="unlock-sub">请输入「${escapeHtml(body.eventName || '')}」的管理密码</p>
      <form id="unlock-form">
        <input type="password" id="unlock-password" placeholder="管理密码" autocomplete="current-password" required />
        <div class="unlock-error hidden" id="unlock-error" role="alert"></div>
        <button type="submit" class="unlock-submit" id="unlock-submit">进入账簿</button>
      </form>
      <p class="unlock-note">管理密码用于解密本账簿数据，忘记将无法恢复</p>
    </div>`
}

async function submitUnlock(body) {
  const input = document.getElementById('unlock-password')
  const errEl = document.getElementById('unlock-error')
  const submit = document.getElementById('unlock-submit')
  const password = input ? input.value : ''
  if (!password) return
  if (submit) { submit.disabled = true; submit.textContent = '正在验证…' }
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden') }
  try {
    const check = body.verifier ? await body.verifier(password) : { ok: true }
    if (check.ok) {
      closeModal()
      if (body.onSuccess) body.onSuccess(password)
    } else {
      if (errEl) { errEl.textContent = check.message || '密码不正确，请重试'; errEl.classList.remove('hidden') }
      if (submit) { submit.disabled = false; submit.textContent = '进入账簿' }
    }
  } catch {
    if (errEl) { errEl.textContent = '无法连接服务器，请检查网络后重试'; errEl.classList.remove('hidden') }
    if (submit) { submit.disabled = false; submit.textContent = '进入账簿' }
  }
}

function exportMarkup(body) {
  const opts = [
    { fmt: 'excel', icon: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5v10M15 9.5v10"/>', title: 'Excel 表格', sub: '.xlsx 明细表' },
    { fmt: 'pdf', icon: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 13h6M9 16.5h4"/>', title: `PDF ${body.bookTitle || ''}`, sub: '含封面与竖排版式' },
    { fmt: 'word', icon: '<path d="M5 4h14v16H5z"/><path d="M8 8l1.6 8 1.4-5 1.4 5L14 8"/>', title: 'Word 文档', sub: '明细 + 备注 + 修改记录' },
  ]
  const optsHtml = opts.map((o) => `
    <button type="button" class="export-option" data-export-format="${o.fmt}">
      <span class="export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7">${o.icon}</svg></span>
      <span class="export-text"><b>${escapeHtml(o.title)}</b><small>${escapeHtml(o.sub)}</small></span>
    </button>`).join('')
  return `
    <div class="unlock-card export-card">
      <button type="button" class="unlock-close" aria-label="关闭" id="unlock-close">×</button>
      <div class="unlock-seal" aria-hidden="true">导</div>
      <h3 class="unlock-title">导出账簿</h3>
      <p class="unlock-sub">「${escapeHtml(body.eventName || '')}」共 ${escapeHtml(body.count || 0)} 条${escapeHtml(body.recordsLabel || '')}</p>
      <div class="export-options">${optsHtml}</div>
      <p class="unlock-note">Excel / PDF / Word 都直接下载。PDF 为 A4 横向、含封面与竖排版式；Word 为 A4 纵向，含明细、备注汇总与修改记录。</p>
    </div>`
}

function render(root) {
  let container = root.querySelector('#modal-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'modal-container'
    container.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden'
    root.appendChild(container)
  }
  const modal = st.modal
  const open = modal.open
  // 仅在 token 变化（新弹窗）或开合状态变化时重渲染内容，避免重复刷新。
  if (open && (lastToken !== modal.token || lastOpen !== open)) {
    container.classList.remove('hidden', 'gb-open')
    // 遮罩容器是常驻复用的：移除 class 并强制重排，让 veil-in 每次打开都重播。
    void container.offsetWidth
    container.classList.add('gb-open')
    container.innerHTML = `
      <div id="modal" class="modal-card ${sizeClass(modal.size)} ${modal.theme === 'theme-solemn' ? 'theme-solemn' : ''} ${modal.theme === 'theme-festive' ? 'theme-festive' : ''}" role="dialog" aria-modal="true" ${modal.title ? 'aria-labelledby="modal-title"' : ''} tabindex="-1">
        <div class="modal-head">
          <h3 id="modal-title" class="modal-title"></h3>
          <button type="button" id="modal-close" class="modal-close" title="关闭" aria-label="关闭弹窗">×</button>
        </div>
        <div id="modal-content" class="modal-content"></div>
        <div id="modal-actions" class="modal-actions"></div>
      </div>`
    // 标题可能含账簿名（用户输入），用 textContent 赋值，等价于 Vue 的 {{ }} 自动转义。
    container.querySelector('#modal-title').textContent = modal.title || ''
    renderContent(container.querySelector('#modal-content'), modal.body)
    const actionsEl = container.querySelector('#modal-actions')
    ;(modal.actions || []).forEach((action) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = action.class || 'modal-btn-ghost'
      btn.textContent = action.text || ''
      btn.addEventListener('click', async () => {
        if (action.handler) await action.handler()
        if (!action.keepOpen) closeModal()
      })
      actionsEl.appendChild(btn)
    })
    container.querySelector('#modal-close').addEventListener('click', () => closeModal())
    document.body.style.overflow = 'hidden'
    lastToken = modal.token
    lastOpen = open
  } else if (!open && lastOpen !== open) {
    container.classList.add('hidden')
    container.classList.remove('gb-open')
    container.innerHTML = ''
    if (activeComponent && activeComponent.destroy) {
      try { activeComponent.destroy() } catch { /* 忽略 */ }
      activeComponent = null
    }
    document.body.style.overflow = ''
    lastToken = modal.token
    lastOpen = open
  }
}

export function mountAppModal(root) {
  render(root)
  subscribe(() => render(root))
}
