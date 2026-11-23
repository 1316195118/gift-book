// 主家侧的宾客登记面板：开链接、看待确认名单、确认入库。
// 明文登记只在服务端暂存，确认时用当前账簿密码加密成正式礼金，再删掉明文。
import { state as st } from '../store.js'
import { api } from './api.js'
import { openModal, closeModal, afterModalRender, alert as showAlert } from './modal.js'
import { escapeHtml, newRequestId } from './crypto.js'
import { encryptData, loadEvents } from '../bootstrap.js'
import { notify } from './notify.js'

let info = null
let pending = []

async function refresh(ev) {
  const [status, list] = await Promise.all([api.guestToggle(ev.id, true), api.guestPending(ev.id)])
  info = status.data || {}
  pending = Array.isArray(list.data) ? list.data : []
}

function bodyHtml() {
  const link = info?.url ? `${window.location.origin}${info.url}` : ''
  const rows = pending.length
    ? pending
        .map((item) => `
          <div class="gb-trash-item">
            <label class="gb-guest-pick"><input type="checkbox" data-guest-pick="${escapeHtml(item.id)}" aria-label="选择 ${escapeHtml(item.name)}" /></label>
            <div class="gb-trash-main">
              <b>${escapeHtml(item.name)} · ¥${Number(item.amount || 0).toFixed(2)}</b>
              <span>${escapeHtml(item.relation || '未填关系')} · ${item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : ''}${item.note ? ' · ' + escapeHtml(item.note) : ''}</span>
            </div>
            <span class="gb-trash-actions">
              <button type="button" class="gb-link-btn" data-guest-confirm="${escapeHtml(item.id)}">确认入库</button>
              <button type="button" class="gb-link-btn" data-guest-dismiss="${escapeHtml(item.id)}">忽略</button>
            </span>
          </div>`)
        .join('')
    : '<div class="gb-empty">暂时没有待确认的登记。</div>'
  return `
    <div id="gb-guest-panel" class="gb-trash-list">
      <p class="gb-picker-intro">把链接发给宾客，他们填的信息会先进入待确认区；确认后才写入这本账簿。</p>
      <p class="field-hint is-warning">待确认内容是明文暂存在服务器上的，确认入库或关闭登记时会删除。请不要让无关的人使用这个链接。</p>
      <div class="gb-guest-link">
        <input id="gb-guest-link-input" type="text" readonly value="${escapeHtml(link)}" />
        <button type="button" class="gb-link-btn" data-guest-copy>复制链接</button>
      </div>
      <div class="gb-guest-tools">
        <button type="button" class="gb-link-btn" data-guest-share>获取二维码</button>
      </div>
      <h4 class="gb-snapshot-section-title">待确认登记（${pending.length}）</h4>
      ${pending.length ? '<div class="gb-guest-bulk"><button type="button" class="gb-link-btn" data-guest-all>全选</button><button type="button" class="gb-link-btn" data-guest-confirm-all>确认所选</button></div>' : ''}
      ${rows}
    </div>`
}

async function confirmOne(ev, id) {
  const item = pending.find((entry) => entry.id === id)
  if (!item) return false
  const gift = {
    name: item.name, amount: Number(item.amount), relation: item.relation || '',
    note: item.note || '', operator: '宾客自助登记',
    timestamp: new Date().toISOString(), late: false, source: 'guest-qr',
  }
  const encryptedContent = await encryptData(gift, st.currentPassword)
  await api.createGift({ eventId: ev.id, encryptedContent, requestId: newRequestId() })
  await api.guestDismiss(ev.id, id)
  return true
}

async function confirmMany(ev, ids) {
  let done = 0
  for (const id of ids) {
    try {
      if (await confirmOne(ev, id)) done += 1
    } catch (error) {
      showAlert('部分确认失败', error.message || '请稍后重试')
      break
    }
  }
  await refresh(ev)
  await loadEvents()
  closeModal()
  show(ev)
  if (done) notify.success('已确认入库', `已写入 ${done} 条登记。`)
}

function show(ev) {
  openModal('宾客扫码登记', { type: 'html', html: bodyHtml() }, [
    { text: '关闭扫码登记', class: 'modal-btn-ghost', handler: async () => {
        try {
          await api.guestToggle(ev.id, false)
          closeModal()
          notify.success('扫码登记已关闭', '待确认的明文记录已删除。')
        } catch (err) {
          showAlert('操作失败', err.message || '请稍后重试')
        }
      } },
    { text: '完成', class: 'modal-btn-primary' },
  ], { size: 'large', dismissable: true })

  afterModalRender(() => {
    const root = document.getElementById('gb-guest-panel')
    if (!root) return
    root.addEventListener('click', async (event) => {
      const copy = event.target.closest('[data-guest-copy]')
      if (copy) {
        const input = document.getElementById('gb-guest-link-input')
        try {
          await navigator.clipboard.writeText(input.value)
          notify.success('链接已复制', '')
        } catch {
          input.select()
          document.execCommand?.('copy')
        }
        return
      }
      if (event.target.closest('[data-guest-share]')) {
        try {
          const link = window.location.origin + (info?.url || '')
          // 二维码库只在用户真正分享时加载，避免拖慢首屏与日常记账。
          const { default: QRCode } = await import('qrcode')
          const qr = await QRCode.toDataURL(link, { width: 320, margin: 2 })
          openModal('宾客登记二维码', {
            type: 'html',
            html: `<div class="gb-guest-qr"><img src="${qr}" alt="宾客登记二维码" width="320" height="320" loading="lazy" decoding="async" /><p class="gb-picker-hint">让宾客扫码后填写，登记内容会先进入待确认区。</p></div>`,
          }, [{ text: '关闭', class: 'modal-btn-primary' }], { dismissable: true })
        } catch (err) {
          showAlert('二维码生成失败', err.message || '请复制页面上的链接')
        }
        return
      }
      if (event.target.closest('[data-guest-all]')) {
        root.querySelectorAll('[data-guest-pick]').forEach((box) => { box.checked = true })
        return
      }
      if (event.target.closest('[data-guest-confirm-all]')) {
        const ids = [...root.querySelectorAll('[data-guest-pick]:checked')].map((box) => box.dataset.guestPick)
        if (!ids.length) return showAlert('确认所选', '请先勾选要确认的登记。')
        await confirmMany(ev, ids)
        return
      }
      const confirmButton = event.target.closest('[data-guest-confirm]')
      if (confirmButton) {
        confirmButton.disabled = true
        try {
          if (!(await confirmOne(ev, confirmButton.dataset.guestConfirm))) return
          await refresh(ev)
          await loadEvents()
          closeModal()
          show(ev)
          notify.success('已确认入库', '登记已加密写入账簿。')
        } catch (err) {
          confirmButton.disabled = false
          showAlert('确认失败', err.message || '请稍后重试')
        }
        return
      }
      const dismissButton = event.target.closest('[data-guest-dismiss]')
      if (dismissButton) {
        try {
          await api.guestDismiss(ev.id, dismissButton.dataset.guestDismiss)
          await refresh(ev)
          closeModal()
          show(ev)
        } catch (err) {
          showAlert('操作失败', err.message || '请稍后重试')
        }
      }
    })
  })
}

export async function openGuestPanel(ev) {
  try {
    await refresh(ev)
    show(ev)
  } catch (err) {
    showAlert('宾客扫码登记', err.message || '读取失败')
  }
}
