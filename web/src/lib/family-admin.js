// 家庭管理（站点管理员）：查看家庭、创建家庭、重置访问码、改为开放家庭。
// 访问码只显示「已设置 / 免访问码」，不回显明文。
import { api } from './api.js'
import { openModal, closeModal, afterModalRender, alert as showAlert, confirm } from './modal.js'
import { escapeHtml } from './crypto.js'
import { familyCodeProblem, familyCodeHint } from './family-code.js'
import { state as st } from '../store.js'
import { notify } from './notify.js'

let families = []
let busy = false

// 访问码强度实时提示：输入时更新文本，弱码标红。
function paintCodeHint(inputId, hintId) {
  const input = document.getElementById(inputId)
  const hint = document.getElementById(hintId)
  if (!input || !hint) return
  const state = familyCodeHint(input.value)
  hint.textContent = state.text
  hint.classList.toggle('is-warning', state.level === 'weak' && Boolean(input.value.trim()))
}

function statusText(item) {
  return item.hasCode ? '已设访问码' : '免访问码（开放家庭）'
}

function renderList() {
  const list = document.getElementById('gb-family-list')
  if (!list) return
  const summary = document.getElementById('gb-family-summary')
  if (summary) {
    const total = families.reduce((sum, item) => sum + (item.eventCount || 0), 0)
    summary.textContent = `共 ${families.length} 个家庭 · ${total} 本账簿`
  }
  list.innerHTML = families.length
    ? families.map((item) => `
      <div class="gb-family-row" data-family-id="${escapeHtml(item.id)}">
        <div class="gb-family-main">
          <b>${escapeHtml(item.name)}${item.isDefault ? '<small class="gb-family-tag">默认</small>' : ''}</b>
          <span>${item.eventCount ? `${item.eventCount} 本账簿` : '还没有账簿'} · ${statusText(item)}</span>
        </div>
        <span class="gb-family-actions">
          <button type="button" class="gb-family-enter" data-family-enter="${escapeHtml(item.id)}">进入</button>
          <button type="button" class="gb-family-more" data-family-menu="${escapeHtml(item.id)}" aria-label="更多操作">⋯</button>
        </span>
      </div>`).join('')
    : '<div class="gb-empty">还没有家庭，先在下面创建一个。</div>'
}

function setError(text) {
  const el = document.getElementById('gb-family-error')
  if (el) el.textContent = text || ''
}

function showAdmin() {
  const authReady = Boolean(st.authEnabled)
  const html = `
    <div id="gb-family-admin" class="gb-picker">
      <p class="gb-picker-intro">家庭之间互相看不到账簿。访问码只用于进入家庭，不替代账簿自己的管理密码。</p>
      <p class="gb-family-summary" id="gb-family-summary"></p>
      <div id="gb-family-list" class="gb-family-list"></div>
      <div class="gb-family-create">
        <h4>新建家庭</h4>
        ${authReady ? '' : '<p class="gb-picker-hint is-warning">多家庭需要管理员密码：请先关闭本窗口，在「设置 → 管理员密码」里设置后再创建。</p>'}
        <div class="gb-form-grid">
          <div class="field"><label for="gb-family-name">家庭名称</label><input id="gb-family-name" type="text" maxlength="40" placeholder="如：王家" /></div>
          <div class="field"><label for="gb-family-code">访问码（选填）</label><input id="gb-family-code" type="text" maxlength="128" placeholder="留空 = 开放家庭" autocomplete="off" ${authReady ? '' : 'disabled'} /><p class="gb-picker-hint" id="gb-family-code-hint"></p></div>
        </div>
        <p class="gb-picker-hint">留空表示任何能打开本站的人都能进入这个家庭，建议只在已设置管理员密码时使用。</p>
        <button type="button" id="gb-family-create-btn" class="modal-btn-primary" ${authReady ? '' : 'disabled'}>创建家庭</button>
      </div>
      <div id="gb-family-error" class="gb-inline-error" role="alert"></div>
    </div>`
  openModal('家庭管理', { type: 'html', html }, [{ text: '关闭', class: 'modal-btn-ghost' }], { size: 'large', dismissable: true })
  afterModalRender(() => {
    renderList()
    const root = document.getElementById('gb-family-admin')
    if (!root) return
    document.getElementById('gb-family-code')?.addEventListener('input', () => {
      paintCodeHint('gb-family-code', 'gb-family-code-hint')
    })
    root.addEventListener('click', async (event) => {
      const enterId = event.target.closest('[data-family-enter]')?.dataset.familyEnter
      if (enterId) {
        const item = families.find((f) => f.id === enterId)
        if (item) await enterFamily(item)
        return
      }
      const menuId = event.target.closest('[data-family-menu]')?.dataset.familyMenu
      if (menuId) {
        const item = families.find((f) => f.id === menuId)
        if (item) openFamilyMenu(item)
        return
      }
      if (event.target.id === 'gb-family-create-btn') {
        await createFamily()
      }
    })
  })
}

async function refresh() {
  const result = await api.listFamilies()
  families = Array.isArray(result.data) ? result.data : []
  renderList()
}

async function createFamily() {
  if (busy) return
  if (!st.authEnabled) return setError('开启多家庭前，请先在「设置 → 管理员密码」里设置管理员密码。')
  const name = String(document.getElementById('gb-family-name')?.value || '').trim()
  const code = String(document.getElementById('gb-family-code')?.value || '').trim()
  if (!name) return setError('请填写家庭名称。')
  if (code) {
    const problem = familyCodeProblem(code)
    if (problem) {
      paintCodeHint('gb-family-code', 'gb-family-code-hint')
      return setError(problem)
    }
  }
  busy = true
  setError('')
  try {
    await api.createFamily({ name, accessCode: code })
    await refresh()
    // 家庭数变化会影响「管理员密码」开关是否可关闭，立即同步，避免要刷新才生效。
    st.multiFamily = families.length > 1
    const nameInput = document.getElementById('gb-family-name')
    const codeInput = document.getElementById('gb-family-code')
    if (nameInput) nameInput.value = ''
    if (codeInput) codeInput.value = ''
    notify.success('家庭已创建', code ? '把访问码告诉这个家庭即可进入。' : '这是开放家庭，进入时不需要访问码。')
  } catch (error) {
    if (error?.code === 'ADMIN_PASSWORD_REQUIRED') {
      setError('开启多家庭前，请先在「设置 → 管理员密码」里设置管理员密码。')
    } else {
      setError(error.message || '创建失败，请稍后重试。')
    }
  } finally {
    busy = false
  }
}


async function enterFamily(item) {
  try {
    await api.familyLogin({ familyId: item.id })
    location.reload()
  } catch (error) {
    // 管理员会话过期、或者这个家庭本来就有码：这里没法替用户输入，指回家庭门。
    if (error?.code === 'FAMILY_CODE') {
      showAlert('需要访问码', `「${item.name}」设有访问码。请关闭本窗口，在家庭门输入访问码后进入。`)
      return
    }
    showAlert('无法进入家庭', error.message || '请稍后重试。')
  }
}

function openFamilyMenu(item) {
  const html = `
    <div id="gb-family-menu" class="gb-family-menu">
      <p class="gb-picker-intro">「${escapeHtml(item.name)}」· ${item.eventCount ? `${item.eventCount} 本账簿` : '还没有账簿'} · ${statusText(item)}</p>
      <div class="gb-family-menu-list">
        <button type="button" class="gb-family-menu-item" data-menu-act="reset">重置访问码<small>换新码，旧设备需要重新验证</small></button>
        ${item.hasCode ? '<button type="button" class="gb-family-menu-item" data-menu-act="open">改为开放家庭<small>取消访问码，任何能打开本站的人都能进入</small></button>' : ''}
        <button type="button" class="gb-family-menu-item" data-menu-act="logout">退出所有设备<small>所有成员重新输入访问码</small></button>
        ${item.isDefault ? '' : '<button type="button" class="gb-family-menu-item is-danger" data-menu-act="delete">删除家庭<small>需要再次输入管理员密码，数据归档到服务器</small></button>'}
      </div>
    </div>`
  openModal('家庭操作', { type: 'html', html }, [{ text: '取消', class: 'modal-btn-ghost' }], { size: 'default', dismissable: true })
  afterModalRender(() => {
    const root = document.getElementById('gb-family-menu')
    if (!root) return
    root.addEventListener('click', (event) => {
      const act = event.target.closest('[data-menu-act]')?.dataset.menuAct
      if (!act) return
      closeModal()
      setTimeout(() => {
        if (act === 'reset') openReset(item)
        if (act === 'open') openToOpen(item)
        if (act === 'logout') forceLogout(item)
        if (act === 'delete') openDelete(item)
      }, 140)
    })
  })
}

function openToOpen(item) {
  confirm('改为开放家庭', `「${item.name}」将取消访问码，任何能打开本站的人都能进入。确定吗？`, async () => {
    try {
      await api.updateFamily(item.id, { accessCode: '' })
      await showFamilyAdmin()
      notify.success('已改为开放家庭', `「${item.name}」现在不需要访问码。`)
    } catch (error) {
      showAlert('操作失败', error.message || '请稍后重试。')
    }
  })
}

function forceLogout(item) {
  confirm('退出所有设备', `将让「${item.name}」的所有设备重新输入访问码，包括当前设备。确定吗？`, async () => {
    try {
      await api.logoutAllDevices(item.id)
      notify.success('已退出所有设备', '请重新选择家庭并输入访问码。')
      setTimeout(() => location.reload(), 700)
    } catch (error) {
      showAlert('操作失败', error.message || '请稍后重试。')
    }
  })
}

function openReset(item) {
  const html = `
    <div id="gb-family-reset">
      <p class="gb-picker-intro">为「${escapeHtml(item.name)}」设置新的访问码。旧码立即失效，已经登录的设备会在 Cookie 过期后重新验证。</p>
      <div class="field"><label for="gb-family-new-code">新访问码（至少 8 位）</label><input id="gb-family-new-code" type="text" autocomplete="off" /><p class="gb-picker-hint" id="gb-family-new-code-hint"></p></div>
      <p class="gb-picker-hint">留空并保存 = 改为开放家庭，不需要访问码。</p>
      <div id="gb-family-reset-error" class="gb-inline-error" role="alert"></div>
    </div>`
  openModal('重置访问码', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '保存',
      class: 'modal-btn-primary',
      keepOpen: true,
      handler: async () => {
        const code = String(document.getElementById('gb-family-new-code')?.value || '').trim()
        const err = document.getElementById('gb-family-reset-error')
        if (code) {
          const problem = familyCodeProblem(code)
          if (problem) {
            paintCodeHint('gb-family-new-code', 'gb-family-new-code-hint')
            if (err) err.textContent = problem
            return
          }
        }
        try {
          await api.updateFamily(item.id, { accessCode: code })
          closeModal()
          notify.success(code ? '访问码已重置' : '已改为开放家庭', code ? '请把新访问码告诉这个家庭。' : '进入时不再需要访问码。')
          await showFamilyAdmin()
        } catch (error) {
          if (err) err.textContent = error.message || '保存失败。'
        }
      },
    },
  ], { dismissable: true })
  afterModalRender(() => {
    document.getElementById('gb-family-new-code')?.addEventListener('input', () => {
      paintCodeHint('gb-family-new-code', 'gb-family-new-code-hint')
    })
  })
}

export async function showFamilyAdmin() {
  try {
    const result = await api.listFamilies()
    families = Array.isArray(result.data) ? result.data : []
    st.multiFamily = families.length > 1
  } catch (error) {
    return showAlert('家庭管理', error.message || '读取家庭失败。')
  }
  showAdmin()
}

// 删除家庭：醒目警告 + 输入家庭名 + 二次输入管理员密码。
function openDelete(item) {
  const html = `
    <div id="gb-family-delete">
      <div class="gb-danger-box">
        <b>删除「${escapeHtml(item.name)}」及其 ${item.eventCount || 0} 本账簿</b>
        <p>该家庭的成员会立即失去访问；账簿与礼金会从页面移除，并归档到服务器的 <code>.trash</code> 目录，需要人工取回。</p>
        <p>不会影响其他家庭。此操作不能在页面中撤销。</p>
      </div>
      <div class="field">
        <label for="gb-family-delete-name" class="field-label">输入家庭名称以确认</label>
        <input id="gb-family-delete-name" type="text" autocomplete="off" placeholder="${escapeHtml(item.name)}" />
      </div>
      <div class="field">
        <label for="gb-family-delete-password" class="field-label">管理员密码 <span class="opt">再次验证</span></label>
        <input id="gb-family-delete-password" type="password" autocomplete="current-password" placeholder="输入当前管理员密码" />
      </div>
      <div id="gb-family-delete-error" class="gb-inline-error" role="alert"></div>
    </div>`
  openModal('删除家庭', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '永久删除家庭',
      class: 'modal-btn-danger',
      keepOpen: true,
      handler: async () => {
        const name = String(document.getElementById('gb-family-delete-name')?.value || '').trim()
        const password = String(document.getElementById('gb-family-delete-password')?.value || '')
        const fail = (message) => {
          const el = document.getElementById('gb-family-delete-error')
          if (el) el.textContent = message
        }
        if (name !== item.name) return fail('请输入完整的家庭名称')
        if (!password) return fail('请输入管理员密码')
        try {
          const result = await api.deleteFamily(item.id, { confirmName: name, currentPassword: password })
          const data = result.data || {}
          closeModal()
          openModal('家庭已删除', {
            type: 'html',
            html: `<div class="gb-delete-result">
              <p><strong>「${escapeHtml(data.name || item.name)}」已删除。</strong></p>
              ${data.archive
                ? `<p class="confirm-note">${data.events ?? 0} 本账簿已归档到服务器 <code>.trash/${escapeHtml(data.archive)}</code>${data.backups ? '，服务器自动备份也一并归档' : ''}。</p>
                   <p class="confirm-note">需要时可以到「设置 → 家庭归档」恢复；恢复后是一个新的开放家庭。</p>`
                : `<p class="confirm-note">该家庭没有账簿，没有生成账簿归档${data.backups ? '；服务器自动备份已移到 .trash 下的独立目录' : ''}。</p>`}
            </div>`,
          }, [{ text: '知道了', class: 'modal-btn-primary', handler: () => location.reload() }], { size: 'default', dismissable: true })
        } catch (error) {
          fail(error.message || '删除失败，请重试')
        }
      },
    },
  ], { size: 'default', dismissable: true })
}
