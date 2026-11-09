// 账簿设置：名称/时间/地点/备注、语音、封面、收款码、删除账簿，以及新增的备份导入导出。
import { state as st, updateSessionEvent, clearSession } from '../store.js'
import { api, ApiError } from './api.js'
import { openModal, closeModal, alert as showAlert, afterModalRender } from './modal.js'
import { copyOf } from './content.js'
import { formatCurrency, escapeHtml } from './crypto.js'
import { loadEvents, showHome } from '../bootstrap.js'
import { verifyLedgerPassword, ledgerKeyOf } from './actions.js'
import { buildVoiceGroups, voiceHint, previewVoice } from './voice.js'
import { getVoiceOptions, saveVoiceOptions, qrStorageKey } from './prefs.js'
import { showQrDialog } from './qr-dialog.js'
import { label, hint, shell, ICON_PIN, ICON_NOTE, ICON_MONEY } from './field-parts.js'

const MAX_COVER_IMAGE_SIZE = 2 * 1024 * 1024

export function openSettings({ section = 'general' } = {}) {
  const ev = st.currentEvent
  if (!ev) return
  if (section === 'delete') return deleteEventFlow()
  const copy = copyOf(ev, st.homeCategory)
  const startDate = ev.startDateTime ? ev.startDateTime.slice(0, 10) : ''
  const startTime = ev.startDateTime ? ev.startDateTime.slice(11, 16) : ''
  const endDate = ev.endDateTime ? ev.endDateTime.slice(0, 10) : ''
  const endTime = ev.endDateTime ? ev.endDateTime.slice(11, 16) : ''
  const { groups } = buildVoiceGroups()
  const voice = getVoiceOptions()
  const groupHtml = groups
    .map((g) => `<optgroup label="${escapeHtml(g.label)}">${g.options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === ev.voiceName ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</optgroup>`)
    .join('')

  const html = `
    <div class="settings-form">
      <section class="settings-section">
        <h4 class="settings-title">基本信息</h4>
        <div class="field">
          ${label('edit-event-name-input', '事项名称', '<span class="req">*</span>')}
          <input type="text" id="edit-event-name-input" value="${escapeHtml(ev.name)}" maxlength="120" />
        </div>
        <div class="event-settings-grid grid grid-cols-2 gap-3">
          <div class="field">${label('edit-start-date', '开始日期')}<input type="date" id="edit-start-date" value="${startDate}" /></div>
          <div class="field">${label('edit-start-time', '开始时间')}<input type="time" id="edit-start-time" value="${startTime}" /></div>
          <div class="field">${label('edit-end-date', '结束日期')}<input type="date" id="edit-end-date" value="${endDate}" /></div>
          <div class="field">${label('edit-end-time', '结束时间')}<input type="time" id="edit-end-time" value="${endTime}" /></div>
        </div>
        <div class="event-settings-grid grid grid-cols-2 gap-3">
          <div class="field">
            ${label('edit-event-location', copy.locationLabel)}
            ${shell({ icon: ICON_PIN, input: `<input type="text" id="edit-event-location" value="${escapeHtml(ev.location || '')}" placeholder="选填" maxlength="200" />` })}
          </div>
          <div class="field">
            ${label('edit-event-note', '账簿备注')}
            ${shell({ icon: ICON_NOTE, input: `<input type="text" id="edit-event-note" value="${escapeHtml(ev.note || '')}" placeholder="选填" maxlength="4000" />` })}
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h4 class="settings-title">语音播报</h4>
        <div class="voice-toggle-row">
          <div><div class="voice-toggle-main">录入成功后朗读「姓名 + 金额」</div><div class="field-hint">关闭后不再播报，记录照常保存</div></div>
          <label class="switch"><input type="checkbox" id="edit-voice-enabled" ${ev.voiceEnabled !== false ? 'checked' : ''} /><span class="switch-track" aria-hidden="true"></span></label>
        </div>
        <div class="field">
          ${label('edit-event-voice', '音色')}
          <div class="field-row">
            <select id="edit-event-voice"><option value="">默认音色</option>${groupHtml}</select>
            <button type="button" id="preview-edit-voice-btn" class="themed-button-secondary field-inline-btn">预览</button>
          </div>
        </div>
        <div class="field">
          ${label('edit-min-speech-amount', '起报金额')}
          ${shell({ icon: ICON_MONEY, suffix: '元', input: `<input type="number" id="edit-min-speech-amount" min="0" step="1" inputmode="numeric" value="${Number(ev.minSpeechAmount) || 0}" />` })}
          ${hint(copy.speechHint)}
        </div>
        <div class="field">
          ${label('edit-voice-rate', '语速与音量')}
          <div class="range-grid">
            <div>
              <div class="range-head"><span>语速</span><b id="voice-rate-val">${voice.rate.toFixed(1)}×</b></div>
              <input type="range" id="edit-voice-rate" min="0.5" max="2" step="0.1" value="${voice.rate}" />
            </div>
            <div>
              <div class="range-head"><span>音量</span><b id="voice-volume-val">${Math.round(voice.volume * 100)}%</b></div>
              <input type="range" id="edit-voice-volume" min="0" max="1" step="0.1" value="${voice.volume}" />
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h4 class="settings-title">封面与收款</h4>
        <div class="field">
          ${label('edit-cover-image-upload', copy.bookTitle + '封面图')}
          <img id="edit-cover-preview" src="${escapeHtml(ev.coverImage || '')}" alt="封面预览" class="cover-edit-preview ${ev.coverImage ? '' : 'hidden'}" />
          <input type="file" id="edit-cover-image-upload" accept="image/*" />
          ${hint('尺寸建议 842 × 595px，格式 jpg/PNG，大小不超过 2MB。')}
        </div>
        <button type="button" id="edit-qr-btn" class="themed-button-secondary field-action">设置 / 更换收款码</button>
      </section>

      <section class="settings-section">
        <h4 class="settings-title">数据</h4>
        <button type="button" id="edit-backup-btn" class="themed-button-secondary field-action">导出这本账簿</button>
        ${hint('导出的是当前账簿的密文数据，可在首页「自动备份」里还原。要备份全部账簿请用首页的自动备份。')}
        <button type="button" id="edit-delete-btn" class="field-danger">删除这本账簿</button>
      </section>
    </div>`

  openModal('账簿设置', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '保存',
      class: 'modal-btn-primary',
      keepOpen: true,
      handler: async () => {
        const newName = document.getElementById('edit-event-name-input').value.trim()
        const start = `${document.getElementById('edit-start-date').value}T${document.getElementById('edit-start-time').value}`
        const end = `${document.getElementById('edit-end-date').value}T${document.getElementById('edit-end-time').value}`
        if (!newName) return showAlert('错误', '事项名称不能为空！')
        if (start && end && new Date(start) >= new Date(end)) return showAlert('错误', '开始时间必须早于结束时间。')
        const payload = {
          name: newName,
          voiceName: document.getElementById('edit-event-voice').value,
          voiceEnabled: document.getElementById('edit-voice-enabled').checked,
          minSpeechAmount: parseFloat(document.getElementById('edit-min-speech-amount').value) || 0,
          location: document.getElementById('edit-event-location').value.trim(),
          note: document.getElementById('edit-event-note').value.trim(),
        }
        if (start) payload.startDateTime = start
        if (end) payload.endDateTime = end
        const coverInput = document.getElementById('edit-cover-image-upload')
        if (coverInput.files?.[0]) {
          const file = coverInput.files[0]
          if (file.size > MAX_COVER_IMAGE_SIZE) return showAlert('图片过大', '封面图不能超过 2MB，请压缩后上传。')
          payload.coverImage = await readAsBase64(file)
        }
        try {
          const result = await api.updateEvent(ev.id, payload)
          st.currentEvent = { ...st.currentEvent, ...payload, ...(result.data || {}) }
          updateSessionEvent(st.currentEvent)
          closeModal()
          showAlert('成功', '账簿设置已保存。')
        } catch (error) {
          showAlert('错误', error.message ? `账簿设置保存失败：${error.message}` : '账簿设置保存失败。')
        }
      },
    },
  ])

  afterModalRender(() => {
    document.getElementById('preview-edit-voice-btn')?.addEventListener('click', () => {
      previewVoice(document.getElementById('edit-event-voice').value, copy.voiceSample)
    })
    document.getElementById('edit-qr-btn')?.addEventListener('click', () => {
      closeModal()
      setTimeout(() => showQrDialog(), 150)
    })
    document.getElementById('edit-backup-btn')?.addEventListener('click', () => {
      closeModal()
      exportCurrentEvent()
    })
    document.getElementById('edit-delete-btn')?.addEventListener('click', () => {
      closeModal()
      deleteEventFlow()
    })
    const rate = document.getElementById('edit-voice-rate')
    const volume = document.getElementById('edit-voice-volume')
    const syncVoice = () => {
      const rateValue = Math.min(2, Math.max(0.5, parseFloat(rate.value) || 1))
      const volumeValue = Math.min(1, Math.max(0, parseFloat(volume.value) || 1))
      document.getElementById('voice-rate-val').textContent = rateValue.toFixed(1) + '×'
      document.getElementById('voice-volume-val').textContent = Math.round(volumeValue * 100) + '%'
      saveVoiceOptions({ rate: rateValue, volume: volumeValue })
    }
    rate?.addEventListener('input', syncVoice)
    volume?.addEventListener('input', syncVoice)
    const fileInput = document.getElementById('edit-cover-image-upload')
    const preview = document.getElementById('edit-cover-preview')
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        preview.src = String(reader.result || '')
        preview.classList.remove('hidden')
      }
      reader.readAsDataURL(file)
    })
  })
}

// 导出当前这本账簿（只含密文）。带账簿钥匙，服务端据此放行。
function exportCurrentEvent() {
  const ev = st.currentEvent
  if (!ev) return
  const key = ledgerKeyOf(st.currentPassword)
  const url = `/api/events/${encodeURIComponent(ev.id)}/export`
  // 下载需要带自定义请求头，用 fetch + Blob 而不是直接跳转
  fetch(url, { headers: { 'X-Ledger-Key': key }, credentials: 'same-origin', cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) {
        let message = '导出失败'
        try {
          const data = await res.json()
          if (data?.message) message = data.message
        } catch { /* 非 JSON 响应 */ }
        throw new Error(message)
      }
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${ev.name || '礼簿'}.zip`
      document.body.appendChild(link)
      link.click()
      setTimeout(() => {
        URL.revokeObjectURL(link.href)
        link.remove()
      }, 1500)
    })
    .catch((err) => showAlert('导出失败', err.message || '请稍后重试'))
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function deleteEventFlow() {
  const ev = st.currentEvent
  if (!ev) return
  const copy = copyOf(ev, st.homeCategory)
  const hasPassword = ev.hasPassword
  const html = `
    <div class="modal-danger-tip"><span aria-hidden="true">⚠️</span><span>即将删除账簿「${escapeHtml(ev.name)}」<b>及其全部${copy.recordsLabel}</b>，删除后无法在页面中恢复（服务器会在数据目录 .trash 中保留一份备份）。<br>${copy.deleteSingleNote}</span></div>
    ${hasPassword
      ? '<label class="block text-sm text-gray-600 mt-3" for="delete-confirm-password">请输入管理密码以继续</label><input type="password" id="delete-confirm-password" class="w-full p-2 border rounded themed-ring mt-1" autocomplete="current-password" />'
      : '<label class="block text-sm text-gray-600 mt-3" for="delete-confirm-text">该账簿没有管理密码，请输入「确认」两个字以继续</label><input type="text" id="delete-confirm-text" class="w-full p-2 border rounded themed-ring mt-1" placeholder="确认" autocomplete="off" />'}
    <div class="access-error hidden mt-2" id="delete-confirm-error" role="alert"></div>`
  openModal('删除账簿', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '确认删除',
      class: 'modal-btn-danger',
      keepOpen: true,
      handler: async () => {
        const errorEl = document.getElementById('delete-confirm-error')
        const fail = (message) => {
          if (errorEl) {
            errorEl.textContent = message
            errorEl.classList.remove('hidden')
          }
        }
        if (hasPassword) {
          const value = document.getElementById('delete-confirm-password')?.value || ''
          let verified
          try {
            verified = await verifyLedgerPassword(ev.id, value)
          } catch {
            return fail('无法连接服务器，账簿未删除。')
          }
          if (!verified.ok) return fail(`${verified.message || '管理密码不正确'}，账簿未删除。`)
        } else {
          const value = (document.getElementById('delete-confirm-text')?.value || '').trim()
          if (value !== '确认') return fail('请输入「确认」两个字后再删除。')
        }
        try {
          await api.deleteEvent(ev.id)
          closeModal()
          clearSession()
          st.currentEvent = null
          st.currentPassword = null
          st.gifts = []
          await loadEvents()
          showHome()
          showAlert('成功', `账簿 “${escapeHtml(ev.name)}” 及其${copy.recordsLabel}已删除。`)
        } catch (error) {
          fail(error.message || '删除失败，请稍后重试。')
        }
      },
    },
  ])
}
