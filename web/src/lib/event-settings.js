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
import { soundEnabled, setSoundEnabled, playTap } from './sound.js'
import { motionPreference, setMotionPreference } from './feedback.js'
import { showQrDialog } from './qr-dialog.js'
import { label, hintIcon, shell, ICON_PIN, ICON_NOTE, ICON_MONEY } from './field-parts.js'
import { ceremonyLabel, ceremonyInputs } from './ceremony.js'
import { totalPagesFor } from './page-size.js'
import { openGuestPanel } from './guest-entry.js'
import { notify } from './notify.js'

const MAX_COVER_IMAGE_SIZE = 2 * 1024 * 1024
let selectedPerPage = 12

// 设置弹窗由 Vue 异步挂载，关闭再打开时内容 DOM 会被替换。
// 偏好开关用 document 级 change 委托，避免绑到已被换掉的旧节点上。
let prefsHandlersBound = false
function bindFeedbackPrefs() {
  if (prefsHandlersBound) return
  prefsHandlersBound = true
  document.addEventListener('change', (event) => {
    const el = event.target
    if (el?.id === 'edit-sound-enabled') {
      setSoundEnabled(el.checked)
      if (el.checked) playTap() // 打开时即时试听一声
    } else if (el?.id === 'edit-motion-full') {
      setMotionPreference(el.checked ? 'full' : 'system')
    }
  })
}

export function openSettings({ section = 'general' } = {}) {
  const ev = st.currentEvent
  if (!ev) return
  if (section === 'delete') return deleteEventFlow()
  bindFeedbackPrefs()
  selectedPerPage = Number(ev.perPage) === 8 || Number(ev.perPage) === 10 ? Number(ev.perPage) : 12
  const copy = copyOf(ev, st.homeCategory)
  const startDate = ev.startDateTime ? ev.startDateTime.slice(0, 10) : ''
  const startTime = ev.startDateTime ? ev.startDateTime.slice(11, 16) : ''
  const endDate = ev.endDateTime ? ev.endDateTime.slice(0, 10) : ''
  const endTime = ev.endDateTime ? ev.endDateTime.slice(11, 16) : ''
  // 正期是「婚礼/殡期」本身的时间，和上面控制录入窗口的起止时间是两回事。
  const ceremony = ceremonyInputs(ev.ceremonyAt)
  const ceremonyName = ceremonyLabel(ev, st.homeCategory)
  // 让用户点选时就看到会变成多少页，而不是保存后才发现。
  let pageRulesDraft = Array.isArray(ev.pageRules)
    ? ev.pageRules.filter((rule) => rule && Number(rule.from) >= 1).map((rule) => ({
        from: Number(rule.from), to: Number(rule.to) || 0, perPage: Number(rule.perPage) || 12,
      }))
    : []
  const pageRuleRow = (rule, index) => `
    <div class="gb-rule-row" data-rule-row="${index}">
      <span>第</span>
      <input type="number" min="1" max="9999" value="${rule.from}" data-rule-field="from" aria-label="起始页" />
      <span>到</span>
      <input type="number" min="0" max="9999" value="${rule.to || ''}" placeholder="末页" data-rule-field="to" aria-label="结束页（留空表示到末页）" />
      <span>页</span>
      <select data-rule-field="perPage" aria-label="每页行数">${[8, 10, 12].map((n) => `<option value="${n}" ${rule.perPage === n ? 'selected' : ''}>${n} 行</option>`).join('')}</select>
      <button type="button" class="gb-rule-remove" data-rule-remove="${index}" aria-label="删除这段规则">×</button>
    </div>`
  const pageRulesMarkup = () => pageRulesDraft.length
    ? pageRulesDraft.map((rule, index) => pageRuleRow(rule, index)).join('')
    : '<p class="gb-picker-hint">还没有页段规则，全部按默认行数。</p>'
  const rerenderRules = () => {
    const box = document.getElementById('gb-page-rules')
    // eslint-disable-next-line no-unsanitized/property -- 内容已 escapeHtml 转义
    if (box) box.innerHTML = pageRulesMarkup()
  }
  const collectPageRules = () => {
    const rows = [...document.querySelectorAll('[data-rule-row]')]
    return rows.map((row) => ({
      from: Number(row.querySelector('[data-rule-field="from"]')?.value) || 0,
      to: Number(row.querySelector('[data-rule-field="to"]')?.value) || 0,
      perPage: Number(row.querySelector('[data-rule-field="perPage"]')?.value) || 12,
    })).filter((rule) => rule.from >= 1 && (rule.to === 0 || rule.to >= rule.from))
  }

  const perPageHint = (size) => {
    const total = st.gifts.length
    const pages = Math.max(1, Math.ceil(total / size))
    return `默认 12 行。当前 ${total} 条，按 ${size} 行/页约 ${pages} 页。`
  }
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
            ${label('edit-ceremony-date', ceremonyName + '（选填）', '', '这是婚礼 / 殡期本身的时间，会显示在账簿卡片上；上面控制「什么时候可以录入」的起止时间不需要改。')}
            <input type="date" id="edit-ceremony-date" value="${ceremony.date}" />
          </div>
          <div class="field">
            ${label('edit-ceremony-time', '时间')}
            <input type="time" id="edit-ceremony-time" value="${ceremony.time}" />
          </div>
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
        <h4 class="settings-title">每页行数${hintIcon('每页 8 / 10 / 12 行，默认 12。改完总页数与本页小计会自动重算，统计口径不变。')}</h4>
        <div class="option-chips" role="group" aria-label="每页行数">
          ${[8, 10, 12].map((n) => `<button type="button" class="option-chip${selectedPerPage === n ? ' active' : ''}" data-per-page="${n}" aria-pressed="${selectedPerPage === n}">${n} 行</button>`).join('')}
        </div>
        <p class="field-hint" id="edit-per-page-hint">${perPageHint(selectedPerPage)}</p>
        <div class="field field-aside">
          <label class="field-label">按页段指定行数</label>
          <div id="gb-page-rules">${pageRulesMarkup()}</div>
          <button type="button" id="gb-add-page-rule" class="gb-link-btn">+ 添加页段</button>
          <p class="field-hint">如「第 1–10 页 12 行、第 11 页起 8 行」。只影响指定页段，其余页用默认行数；不改动已录入记录的顺序。</p>
        </div>
      </section>

      <section class="settings-section">
        <h4 class="settings-title">语音播报</h4>
        <div class="voice-toggle-row">
          <div><div class="voice-toggle-main">录入成功后朗读「姓名 + 金额」${hintIcon('关闭后不再播报，记录照常保存。')}</div></div>
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
          ${label('edit-min-speech-amount', '起报金额', '', copy.speechHint)}
          ${shell({ icon: ICON_MONEY, suffix: '元', input: `<input type="number" id="edit-min-speech-amount" min="0" step="1" inputmode="numeric" value="${Number(ev.minSpeechAmount) || 0}" />` })}
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
          ${label('edit-cover-image-upload', copy.bookTitle + '封面图', '', '尺寸建议 842 × 595px，格式 jpg/PNG，大小不超过 2MB。')}
          <img id="edit-cover-preview" src="${escapeHtml(ev.coverImage || '')}" alt="封面预览" class="cover-edit-preview ${ev.coverImage ? '' : 'hidden'}" width="595" height="842" loading="lazy" decoding="async" />
          <input type="file" id="edit-cover-image-upload" accept="image/*" />
        </div>
        <button type="button" id="edit-qr-btn" class="themed-button-secondary field-action">设置 / 更换收款码</button>
      </section>

      <section class="settings-section">
        <h4 class="settings-title">交互反馈${hintIcon('设备级偏好：切换后立即生效并保存在本机，不随账簿保存，也不影响账簿数据。')}</h4>
        <div class="voice-toggle-row">
          <div>
            <div class="voice-toggle-main">点击、落印与建簿提示音${hintIcon('Web Audio 合成的轻音效，无外部音频文件；系统开启「减弱动态效果」时自动静音。')}</div>
          </div>
          <label class="switch"><input type="checkbox" id="edit-sound-enabled" ${soundEnabled() ? 'checked' : ''} /><span class="switch-track" aria-hidden="true"></span></label>
        </div>
        <div class="voice-toggle-row">
          <div>
            <div class="voice-toggle-main">始终播放完整动效${hintIcon('忽略系统「减弱动态效果」，落印、建簿动效与点击涟漪照常播放；白事不出现任何喜庆元素。')}</div>
          </div>
          <label class="switch"><input type="checkbox" id="edit-motion-full" ${motionPreference() === 'full' ? 'checked' : ''} /><span class="switch-track" aria-hidden="true"></span></label>
        </div>
      </section>

      <section class="settings-section">
        <h4 class="settings-title">结簿归档${hintIcon('结簿只影响这本账簿，不删除任何记录；其他设备刷新后会同步为只读。')}</h4>
        <div class="voice-toggle-row">
          <div>
            <div class="voice-toggle-main">${ev.archived ? '已结簿 · 只读' : '未结簿 · 可录入'}${hintIcon('结簿后禁止录入、纠错、登记回礼、批量导入与扫描录入；查看、统计、打印与导出照常。')}</div>
          </div>
        </div>
        <button type="button" id="edit-archive-btn" class="themed-button-secondary field-action">${ev.archived ? '解除结簿，恢复录入' : '结簿归档（设为只读）'}</button>
      </section>

      <section class="settings-section">
        <h4 class="settings-title">数据${hintIcon('导出的是当前账簿的密文数据，可在首页「备份」里还原；要备份全部账簿请用首页的备份。')}</h4>
        <button type="button" id="edit-guest-btn" class="themed-button-secondary field-action">宾客扫码登记…</button>
        ${st.family?.admin ? '<button type="button" id="edit-move-family-btn" class="themed-button-secondary field-action">转移到其他家庭</button>' : ''}
        <button type="button" id="edit-backup-btn" class="themed-button-secondary field-action">导出这本账簿</button>
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
          perPage: selectedPerPage,
          pageRules: collectPageRules(),
        }
        const ceremonyDate = document.getElementById('edit-ceremony-date').value
        const ceremonyTime = document.getElementById('edit-ceremony-time').value || '00:00'
        payload.ceremonyAt = ceremonyDate ? `${ceremonyDate}T${ceremonyTime}` : ''
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
          // 行数或页段变了：按新规则重算总页数，当前页不能超过上限。
          st.currentPage = Math.min(st.currentPage, totalPagesFor(st.gifts.length))
          closeModal()
          notify.success('账簿设置已保存', '', { duration: 3200 })
        } catch (error) {
          showAlert('错误', error.message ? `账簿设置保存失败：${error.message}` : '账簿设置保存失败。')
        }
      },
    },
  ])

  afterModalRender(() => {
    document.getElementById('gb-add-page-rule')?.addEventListener('click', () => {
      pageRulesDraft = collectPageRules()
      const last = pageRulesDraft[pageRulesDraft.length - 1]
      pageRulesDraft.push({ from: last ? (last.to || last.from) + 1 : 1, to: 0, perPage: selectedPerPage })
      rerenderRules()
    })
    document.getElementById('gb-page-rules')?.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-rule-remove]')
      if (!remove) return
      pageRulesDraft = collectPageRules()
      pageRulesDraft.splice(Number(remove.dataset.ruleRemove), 1)
      rerenderRules()
    })
    document.querySelectorAll('[data-per-page]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedPerPage = Number(button.dataset.perPage)
        const hint = document.getElementById('edit-per-page-hint')
        if (hint) hint.textContent = perPageHint(selectedPerPage)
        document.querySelectorAll('[data-per-page]').forEach((item) => {
          const active = Number(item.dataset.perPage) === selectedPerPage
          item.classList.toggle('active', active)
          item.setAttribute('aria-pressed', String(active))
        })
      })
    })
    document.getElementById('preview-edit-voice-btn')?.addEventListener('click', () => {
      previewVoice(document.getElementById('edit-event-voice').value, copy.voiceSample)
    })
    document.getElementById('edit-qr-btn')?.addEventListener('click', () => {
      closeModal()
      setTimeout(() => showQrDialog(), 150)
    })
    document.getElementById('edit-guest-btn')?.addEventListener('click', () => {
      closeModal()
      setTimeout(() => openGuestPanel(ev), 150)
    })
    document.getElementById('edit-move-family-btn')?.addEventListener('click', () => {
      closeModal()
      setTimeout(() => openMoveFamily(ev), 150)
    })
    document.getElementById('edit-backup-btn')?.addEventListener('click', () => {
      closeModal()
      exportCurrentEvent()
    })
    document.getElementById('edit-delete-btn')?.addEventListener('click', () => {
      closeModal()
      deleteEventFlow()
    })
    document.getElementById('edit-archive-btn')?.addEventListener('click', () => {
      closeModal()
      setTimeout(() => toggleArchive(), 150)
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

// 结簿归档：把账簿切成只读；解除后立刻恢复录入。状态存在 events.json，服务端同步兜底。
function toggleArchive() {
  const ev = st.currentEvent
  if (!ev) return
  const next = ev.archived !== true
  if (next && st.queueCount > 0) {
    return showAlert('暂不能结簿', `还有 ${st.queueCount} 笔离线记录待同步，请先联网同步完成再结簿。`)
  }
  const html = next
    ? `<p>结簿后这本账簿将设为只读：不能录入、纠错、登记回礼、批量导入或扫描录入；查看、统计、打印与导出不受影响。</p>
       <p class="field-hint">已录入的 ${st.gifts.length} 条记录原样保留，随时可以在「账簿设置」里解除结簿。</p>`
    : '<p>解除结簿后，这本账簿会恢复录入与修改。</p>'
  openModal(next ? '结簿归档' : '解除结簿', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: next ? '确认结簿' : '解除结簿',
      class: 'modal-btn-primary',
      keepOpen: true,
      handler: async () => {
        try {
          const archivedAt = next ? new Date().toISOString() : ''
          const result = await api.updateEvent(ev.id, { archived: next, archivedAt })
          st.currentEvent = { ...st.currentEvent, archived: next, archivedAt, ...(result.data || {}) }
          updateSessionEvent(st.currentEvent)
          closeModal()
          notify.success(
            next ? '已结簿归档' : '已解除结簿',
            next ? '账簿现在为只读，可在设置里随时解除。' : '账簿已恢复录入与修改。',
          )
        } catch (error) {
          showAlert('操作失败', error.message ? `结簿设置保存失败：${error.message}` : '结簿设置保存失败。')
        }
      },
    },
  ], { dismissable: true })
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

// 管理员把建错家庭的账簿移到别的家庭：礼金文件按账簿 id 存，转移只改归属。
async function openMoveFamily(ev) {
  let families = []
  try {
    const result = await api.listFamilies()
    families = (result.data || []).filter((family) => family.id !== st.family?.id)
  } catch (error) {
    return showAlert('转移账簿', error.message || '读取家庭失败')
  }
  if (!families.length) return showAlert('转移账簿', '没有其他家庭可以接收这本账簿。')
  const options = families
    .map((family) => `<option value="${escapeHtml(family.id)}">${escapeHtml(family.name)}</option>`)
    .join('')
  const html = `
    <div class="gb-move-family">
      <p>把「${escapeHtml(ev.name)}」转移到：</p>
      <select id="move-family-target">${options}</select>
      <p class="field-hint is-warning">转移后这本账簿会立即从「${escapeHtml(st.family?.name || '当前家庭')}」消失，只有目标家庭的成员能看到；礼金、编号与管理密码都不变。</p>
      <div id="move-family-error" class="gb-inline-error" role="alert"></div>
    </div>`
  openModal('转移账簿', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '确认转移',
      class: 'modal-btn-danger',
      keepOpen: true,
      handler: async () => {
        const target = document.getElementById('move-family-target')?.value
        const errorBox = document.getElementById('move-family-error')
        if (!target) return
        try {
          const result = await api.moveEvent(ev.id, target)
          closeModal()
          notify.success('账簿已转移', `「${ev.name}」现在属于「${result.data?.familyName || '目标家庭'}」。`)
          clearSession()
          showHome()
        } catch (error) {
          if (errorBox) errorBox.textContent = error.message || '转移失败'
        }
      },
    },
  ], { dismissable: true })
}

export async function deleteEventFlow() {
  const ev = st.currentEvent
  if (!ev) return
  const copy = copyOf(ev, st.homeCategory)
  const hasPassword = ev.hasPassword
  const html = `
    <div class="modal-danger-tip"><span aria-hidden="true">⚠️</span><span>即将删除账簿「${escapeHtml(ev.name)}」<b>及其全部${copy.recordsLabel}</b>，删除后可在首页「回收站」里一键恢复（服务器会把整本账簿连同记录留在数据目录 .trash 中）。<br>${copy.deleteSingleNote}</span></div>
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
          notify.success('账簿已删除', `“${ev.name}” 及其${copy.recordsLabel}已删除。`)
        } catch (error) {
          fail(error.message || '删除失败，请稍后重试。')
        }
      },
    },
  ])
}
