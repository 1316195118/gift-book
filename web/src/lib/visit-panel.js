// 主家侧的来访签到面板：开链接、看总人数与名单、生成二维码海报。
// 来访登记提交即计入，无待确认；数据明文跟随账簿 stored，不含金额。
import { state as st } from '../store.js'
import { api } from './api.js'
import { openModal, closeModal, afterModalRender, alert as showAlert, confirm as showConfirm } from './modal.js'
import { escapeHtml } from './crypto.js'
import { notify } from './notify.js'
import { categoryForEvent } from './content.js'
import { guestQrPosterInfo, renderGuestQrPoster } from './guest-qr-poster.js'

let info = null
let visits = []
let currentEvent = null

function visitLink() {
  if (!info?.url) return ''
  const target = new URL(info.url, window.location.origin)
  const base = new URL('.', window.location.href)
  base.search = target.search
  base.hash = ''
  return base.href
}

function expiryText() {
  if (!info?.expiresAt) return '长期有效，关闭来访签到时失效'
  const at = new Date(info.expiresAt)
  if (!Number.isFinite(at.getTime())) return '有效期跟随账簿结束时间'
  return `有效至 ${at.toLocaleString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })}`
}

function summary() {
  const households = visits.length
  const people = visits.reduce((sum, v) => sum + (Number(v.count) || 0), 0)
  return { households, people }
}

async function refresh(ev) {
  const [status, list] = await Promise.all([
    api.visitToggle(ev.id, true),
    api.visitList(ev.id),
  ])
  info = status.data || {}
  visits = Array.isArray(list.data) ? list.data : []
}

function bodyHtml() {
  const link = visitLink()
  const { households, people } = summary()
  const rows = visits.length
    ? visits.map((v) => `
        <div class="gb-trash-item">
          <div class="gb-trash-main">
            <b>${escapeHtml(v.name)} · ${Number(v.count) || 0} 人</b>
            <span>${v.createdAt ? new Date(v.createdAt).toLocaleString('zh-CN') : ''}${v.note ? ' · ' + escapeHtml(v.note) : ''}</span>
          </div>
          <span class="gb-trash-actions">
            <button type="button" class="gb-link-btn" data-visit-delete="${escapeHtml(v.id)}">删除</button>
          </span>
        </div>`).join('')
    : '<div class="gb-empty">还没有来访登记。</div>'

  return `
    <div id="gb-visit-panel" class="gb-trash-list">
      <p class="gb-picker-intro">把链接发给来宾，填写后立即计入来访名单，无需主家确认。</p>
      <p class="field-hint is-warning">来访信息（姓名、人数、备注）以明文跟随账簿保存，不加密、不含金额。请不要让无关的人使用这个链接。</p>
      <div class="gb-visit-summary">
        <div><b>${people}</b><span>到场人数</span></div>
        <div><b>${households}</b><span>登记户数</span></div>
      </div>
      <div class="gb-guest-link">
        <input id="gb-visit-link-input" type="text" readonly value="${escapeHtml(link)}" />
        <button type="button" class="gb-link-btn" data-visit-copy>复制链接</button>
      </div>
      <div class="gb-guest-tools">
        <button type="button" class="gb-link-btn" data-visit-share>生成二维码</button>
      </div>
      <p class="gb-guest-validity">${escapeHtml(expiryText())}</p>
      <h4 class="gb-snapshot-section-title">来访名单（${households} 户 / ${people} 人）</h4>
      ${rows}
    </div>`
}

async function showQr(ev) {
  try {
    const { default: QRCode } = await import('qrcode')
    const link = visitLink()
    if (!link) return showAlert('二维码生成失败', '登记链接尚未开启，请重新打开面板。')
    const qrDataUrl = await QRCode.toDataURL(link, { width: 480, margin: 2, errorCorrectionLevel: 'M' })
    const posterInfo = guestQrPosterInfo(ev, categoryForEvent(ev, st.homeCategory))
    posterInfo.seal = '到'
    const poster = await renderGuestQrPoster({ qrDataUrl, info: posterInfo, expiryText: expiryText() })
    const downloadName = `${posterInfo.eventName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '来访登记'}-签到二维码.png`
    openModal('来访签到二维码', {
      type: 'html',
      html: `
        <div class="gb-guest-qr">
          <div class="gb-guest-qr-card">
            <img src="${poster}" alt="来访签到二维码海报" width="1200" height="1800" decoding="async" data-title="${escapeHtml(posterInfo.eventName)}" data-time="${escapeHtml(posterInfo.time)}" />
            <a class="gb-guest-qr-download" href="${poster}" download="${escapeHtml(downloadName)}">下载图片</a>
            <p class="gb-guest-qr-hint"><b>手机长按海报保存到相册</b><br />电脑可点「下载图片」或右键另存。</p>
          </div>
        </div>`,
    }, [{ text: '关闭', class: 'modal-btn-primary' }], { dismissable: true })
  } catch (err) {
    showAlert('二维码生成失败', err.message || '请复制页面上的链接')
  }
}

async function reopen() {
  await refresh(currentEvent)
  closeModal()
  show(currentEvent)
}

function show(ev) {
  currentEvent = ev
  openModal('来访签到登记', { type: 'html', html: bodyHtml() }, [
    { text: '关闭签到', class: 'modal-btn-ghost', handler: async () => {
      try {
        const ok = await showConfirm('关闭来访签到', '关闭后链接立即失效，已登记的名单会保留。确定关闭吗？')
        if (!ok) return
        await api.visitToggle(ev.id, false)
        notify.success('来访签到已关闭', '已登记的名单仍可在统计里查看。')
        closeModal()
      } catch (err) {
        showAlert('关闭失败', err.message || '请稍后重试')
      }
    } },
    {
      text: '重新生成二维码', class: 'modal-btn-ghost', keepOpen: true,
      handler: async () => {
        try {
          await api.visitToggle(ev.id, true, { regenerate: true })
          await reopen()
          notify.success('已重新生成', '旧链接立即失效。')
        } catch (err) {
          showAlert('重新生成失败', err.message || '请稍后重试')
        }
      },
    },
    { text: '关闭', class: 'modal-btn-primary' },
  ], { size: 'large', dismissable: true })

  afterModalRender(() => {
    const root = document.getElementById('gb-visit-panel')
    if (!root) return
    root.addEventListener('click', async (event) => {
      if (event.target.closest('[data-visit-copy]')) {
        const input = document.getElementById('gb-visit-link-input')
        try {
          await navigator.clipboard.writeText(input.value)
          notify.success('链接已复制', '')
        } catch {
          input.select()
          document.execCommand?.('copy')
        }
        return
      }
      if (event.target.closest('[data-visit-share]')) {
        await showQr(ev)
        return
      }
      const del = event.target.closest('[data-visit-delete]')
      if (del) {
        del.disabled = true
        try {
          await api.visitDelete(ev.id, del.dataset.visitDelete)
          await reopen()
          notify.success('已删除', '这条来访记录已移除。')
        } catch (err) {
          del.disabled = false
          showAlert('删除失败', err.message || '请稍后重试')
        }
      }
    })
  })
}

export async function openVisitPanel(ev) {
  try {
    await refresh(ev)
    show(ev)
  } catch (err) {
    showAlert('来访签到', err.message || '读取失败')
  }
}
