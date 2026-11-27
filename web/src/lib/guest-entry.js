// 主家侧的宾客登记面板：开链接、看待确认名单、确认入库。
// 明文登记只在服务端暂存，确认时用当前账簿密码加密成正式礼金，再删掉明文。
import { state as st } from '../store.js'
import { api } from './api.js'
import { openModal, closeModal, afterModalRender, alert as showAlert, confirm as showConfirm } from './modal.js'
import { escapeHtml, newRequestId } from './crypto.js'
import { encryptData, loadEvents } from '../bootstrap.js'
import { notify } from './notify.js'
import { categoryForEvent } from './content.js'
import { guestQrPosterInfo, renderGuestQrPoster } from './guest-qr-poster.js'

let info = null
let pending = []

function guestLink() {
  if (!info?.url) return ''
  // 保留当前部署路径，兼容反向代理挂在 /giftbook/ 这类子路径的情况。
  const target = new URL(info.url, window.location.origin)
  const base = new URL('.', window.location.href)
  base.search = target.search
  base.hash = ''
  return base.href
}

function guestExpiryText(expiresAt = info?.expiresAt) {
  if (!expiresAt) return '长期有效，关闭扫码登记时失效'
  const at = new Date(expiresAt)
  if (!Number.isFinite(at.getTime())) return '有效期跟随账簿结束时间'
  return `有效至 ${at.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}

async function refresh(ev) {
  const [status, list] = await Promise.all([api.guestToggle(ev.id, true), api.guestPending(ev.id)])
  info = status.data || {}
  pending = Array.isArray(list.data) ? list.data : []
}

function bodyHtml() {
  const link = guestLink()
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
        <button type="button" class="gb-link-btn" data-guest-share>生成二维码</button>
      </div>
      <p class="gb-guest-validity">${escapeHtml(guestExpiryText())}</p>
      <h4 class="gb-snapshot-section-title">待确认登记（${pending.length}）</h4>
      ${pending.length ? '<div class="gb-guest-bulk"><button type="button" class="gb-link-btn" data-guest-all>全选</button><button type="button" class="gb-link-btn" data-guest-confirm-all>确认所选</button></div>' : ''}
      ${rows}
    </div>`
}

async function confirmRegenerate(ev) {
  showConfirm(
    '重新生成二维码',
    '确定生成新的宾客登记二维码吗？\n旧二维码和旧链接会立即失效，已经收到的待确认登记不受影响。',
    async () => {
      try {
        const result = await api.guestToggle(ev.id, true, { regenerate: true })
        info = result.data || {}
        notify.success('二维码已重新生成', '旧二维码已经失效。')
        await showGuestQr(ev)
      } catch (error) {
        showAlert('重新生成失败', error.message || '请稍后再试')
      }
    },
  )
}

async function showGuestQr(ev) {
  const link = guestLink()
  if (!link) return showAlert('无法生成二维码', '登记链接尚未开启，请重新打开扫码登记。')
  try {
    // 二维码库只在真正分享时加载，避免拖慢首屏与日常记账。
    const { default: QRCode } = await import('qrcode')
    const category = categoryForEvent(ev, st.homeCategory)
    const posterInfo = guestQrPosterInfo(ev, category)
    const qr = await QRCode.toDataURL(link, {
      width: 720,
      margin: 3,
      errorCorrectionLevel: 'M',
      color: { dark: '#281f1a', light: '#fffaf1' },
    })
    const poster = await renderGuestQrPoster({
      qrDataUrl: qr,
      info: posterInfo,
      expiryText: guestExpiryText(),
    })
    const posterAlt = `宾客登记二维码海报：${posterInfo.eventName}，${posterInfo.timeLabel}${posterInfo.time}，地点${posterInfo.location}`
    const downloadName = `${posterInfo.eventName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '宾客登记'}-扫码登记.png`
    openModal('宾客登记二维码', {
      type: 'html',
      html: `
        <div class="gb-guest-qr">
          <div class="gb-guest-qr-card">
            <img
              id="gb-guest-qr-poster"
              src="${poster}"
              alt="${escapeHtml(posterAlt)}"
              width="1200"
              height="1800"
              loading="eager"
              decoding="async"
              data-title="${escapeHtml(posterInfo.eventName)}"
              data-time="${escapeHtml(posterInfo.time)}"
              data-location="${escapeHtml(posterInfo.location)}"
              aria-describedby="gb-guest-qr-save-hint"
            />
            <a class="gb-guest-qr-download" href="${poster}" download="${escapeHtml(downloadName)}">下载图片</a>
            <p id="gb-guest-qr-save-hint" class="gb-guest-qr-hint"><b>手机长按海报保存到相册</b><br />电脑可点「下载图片」或右键另存；发给宾客后即可扫码填写。</p>
            <span class="gb-guest-qr-validity">${escapeHtml(guestExpiryText())}</span>
          </div>
          <p class="gb-picker-hint">登记内容会先进入待确认区，主家确认后才加密入簿。</p>
        </div>`,
    }, [
      { text: '关闭', class: 'modal-btn-primary' },
      {
        text: '重新生成二维码',
        class: 'modal-btn-ghost',
        keepOpen: true,
        handler: () => confirmRegenerate(ev),
      },
    ], { dismissable: true })
  } catch (error) {
    showAlert('二维码生成失败', error.message || '请复制页面上的链接')
  }
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
        await showGuestQr(ev)
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
