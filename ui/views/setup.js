// 创建账簿页（原生 JS，零第三方依赖）。
import {
  state as st, subscribe, hashPassword, NO_PASSWORD_HASH, NO_PASSWORD_KEY, LedgerCrypto,
} from '../store.js'
import {
  copyOf, isSolemnEvent, templatesFor, COVER_STYLES, TEMPLATE_DEFAULT_STYLE,
} from '../lib/content.js'
import { renderCoverMarkup } from '../lib/cover.js'
import { escapeHtml } from '../lib/crypto.js'
import { api, ApiError } from '../lib/api.js'
import { showHome, loadEvents, startSession } from '../bootstrap.js'
import { openEvent } from '../lib/actions.js'
import { alert as showAlert } from '../lib/modal.js'
import { buildVoiceGroups, voiceHint, previewVoice } from '../lib/voice.js'
import { success, withBusy, pulse, celebrate } from '../lib/feedback.js'

const MAX_COVER_IMAGE_SIZE = 2 * 1024 * 1024

const form = {
  name: '',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  location: '',
  note: '',
  password: '',
  passwordConfirm: '',
  voiceName: '',
}

let selectedTemplate = null
let selectedStyle = ''
let coverPreview = ''
let submitting = false

const { groups: voiceGroups, usable } = buildVoiceGroups()
let voiceHintText = voiceHint(usable)

function isSolemn() {
  return st.homeCategory === 'white'
}

function templates() {
  return templatesFor(st.homeCategory)
}

function existingOptions() {
  const wantSolemn = isSolemn()
  return Object.values(st.cachedEvents || {}).filter((ev) => isSolemnEvent(ev, st.homeCategory) === wantSolemn)
}

function coverStyles() {
  return COVER_STYLES.filter((item) => item.theme === (isSolemn() ? 'white' : 'red'))
}

function templateKey() {
  if (selectedTemplate) return selectedTemplate
  const match = templates().find((t) => t.name === form.name || t.key === form.name)
  return match ? match.key : templates()[0].key
}

function previewCover() {
  return renderCoverMarkup(
    {
      name: form.name.trim() || '账簿名称',
      theme: isSolemn() ? 'theme-solemn' : 'theme-festive',
      template: templateKey(),
      coverStyle: selectedStyle || TEMPLATE_DEFAULT_STYLE[templateKey()],
      startDateTime: form.startDate ? `${form.startDate}T${form.startTime || '00:00'}` : '',
      location: form.location.trim(),
    },
    false,
    st.homeCategory,
  )
}

function coverFor(styleId) {
  return renderCoverMarkup(
    {
      theme: isSolemn() ? 'theme-solemn' : 'theme-festive',
      template: templateKey(),
      coverStyle: styleId || selectedStyle || TEMPLATE_DEFAULT_STYLE[templateKey()],
    },
    true,
    st.homeCategory,
  )
}

function setDefaultTimes() {
  const now = new Date()
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const pad = (num) => String(num).padStart(2, '0')
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
  form.startDate = fmtDate(now)
  form.startTime = fmtTime(now)
  form.endDate = fmtDate(end)
  form.endTime = fmtTime(end)
}

function initFromTemplate() {
  const key = st.setupTemplate
  if (!key) return
  const template = templates().find((t) => t.key === key)
  if (template) form.name = template.name
  selectedStyle = TEMPLATE_DEFAULT_STYLE[key] || ''
}

const SKELETON = `
<div id="app-container">
  <div id="setup-screen">
    <div class="setup-head">
      <div class="back-link" id="setup-back">← 返回首页</div>
      <div class="setup-badge" id="setup-badge">红 事</div>
    </div>
    <h1 class="setup-title">创建新账簿</h1>
    <p class="setup-sub" id="setup-sub"></p>
    <div class="setup-divider"></div>

    <div id="select-event-section" class="setup-section">
      <div class="setup-section-title">从已有账簿继续</div>
      <div class="setup-select-row">
        <select id="existing-event" aria-label="选择已有账簿">
          <option value="">请选择一本账簿</option>
        </select>
        <button type="button" class="setup-btn-primary" id="enter-existing">进入</button>
      </div>
    </div>

    <div class="setup-body">
      <form class="setup-form" id="setup-form" autocomplete="off">
        <div class="form-section-title"><span>01</span>账簿信息</div>
        <div class="setup-field">
          <label class="setup-label" for="event-name">账簿名称 <span class="req">*</span></label>
          <input type="text" id="event-name" placeholder="" required class="setup-input" />
        </div>

        <div class="setup-grid2">
          <div class="setup-field">
            <label class="setup-label" for="start-date">开始时间 <span class="req">*</span></label>
            <div class="setup-dt">
              <input type="date" id="start-date" required class="setup-input" aria-label="开始日期" />
              <input type="time" id="start-time" required class="setup-input" aria-label="开始时间" />
            </div>
          </div>
          <div class="setup-field">
            <label class="setup-label" for="end-date">结束时间 <span class="req">*</span></label>
            <div class="setup-dt">
              <input type="date" id="end-date" required class="setup-input" aria-label="结束日期" />
              <input type="time" id="end-time" required class="setup-input" aria-label="结束时间" />
            </div>
          </div>
        </div>

        <div class="setup-grid2">
          <div class="setup-field">
            <label class="setup-label" for="event-location" id="setup-location-label">宴席地点</label>
            <div class="field-shell">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" /><circle cx="12" cy="10.6" r="2.4" /></svg>
              <input type="text" id="event-location" placeholder="如：XX 酒店 3 楼宴会厅" class="setup-input" maxlength="200" />
            </div>
          </div>
          <div class="setup-field">
            <label class="setup-label" for="event-note">账簿备注</label>
            <div class="field-shell">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5.5h14M5 10h14M5 14.5h9M5 19h6" /></svg>
              <input type="text" id="event-note" placeholder="备注信息（可选）" class="setup-input" maxlength="4000" />
            </div>
          </div>
        </div>

        <div class="form-section-title"><span>02</span>访问与安全</div>
        <div class="setup-grid2">
          <div class="setup-field">
            <label class="setup-label" for="admin-password">管理密码 <span class="opt">建议设置</span></label>
            <div class="field-shell">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.4v2.6" /></svg>
              <input type="password" id="admin-password" placeholder="留空则不设密码" class="setup-input" autocomplete="new-password" />
            </div>
          </div>
          <div class="setup-field">
            <label class="setup-label" for="admin-password-confirm">确认密码</label>
            <div class="field-shell">
              <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.4v2.6" /></svg>
              <input type="password" id="admin-password-confirm" placeholder="再次输入" class="setup-input" autocomplete="new-password" />
            </div>
          </div>
        </div>
        <p class="setup-hint" id="setup-pwd-hint"></p>

        <details class="setup-more" id="setup-more">
          <summary class="setup-more-summary">
            <span>更多设置（封面 / 语音）</span>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" clip-rule="evenodd" /></svg>
          </summary>
          <div class="setup-more-body">
            <div class="setup-field">
              <label class="setup-label">封面样式</label>
              <div id="cover-style-grid" class="cover-style-grid"></div>
              <p class="setup-hint">点选一套封面，右侧实时预览；导出与打印使用同一套封面。</p>
            </div>
            <div class="setup-field">
              <label for="cover-image-upload" class="setup-label">上传封面图（可选）</label>
              <input type="file" id="cover-image-upload" accept="image/*" class="setup-file" />
              <img id="cover-preview-img" alt="封面预览" class="cover-edit-preview hidden" />
              <p class="setup-hint">不上传也行，导出时会自动生成封面。建议 595 × 842px、小于 2MB。</p>
            </div>
            <div class="setup-field">
              <label for="event-voice" class="setup-label">语音播报音色</label>
              <div class="setup-dt">
                <select id="event-voice">
                  <option value="">默认音色</option>
                </select>
                <button type="button" id="preview-create-voice-btn" class="setup-btn-ghost">试听</button>
              </div>
              <p class="setup-hint" id="voice-hint"></p>
            </div>
          </div>
        </details>

        <button type="submit" id="setup-submit" class="setup-submit">保存并开始记账</button>
      </form>

      <aside class="setup-preview" aria-label="封面实时预览">
        <div class="preview-heading"><span>封面预览</span><small><i aria-hidden="true"></i>实时同步</small></div>
        <div class="preview-cover" id="preview-cover"></div>
        <p class="preview-hint">封面实时渲染，打印时自动排版<br />无需图片，文字与主题同步更新</p>
      </aside>
    </div>
  </div>
</div>`

export function mountSetup(root) {
  // 每次进入创建页都从干净状态开始：form 是模块级对象，会跨页面保留上次输入。
  Object.assign(form, {
    name: '', startDate: '', startTime: '', endDate: '', endTime: '',
    location: '', note: '', password: '', passwordConfirm: '', voiceName: '',
  })
  selectedTemplate = st.setupTemplate || null
  selectedStyle = ''
  coverPreview = ''
  submitting = false
  // 默认起止时间（现在 ~ 24 小时后）与模板名，缺了它们 HTML5 required 会直接拦住提交。
  setDefaultTimes()
  initFromTemplate()
  loadEvents()

  root.innerHTML = SKELETON
  const $ = (id) => root.querySelector(id)
  const copy = () => copyOf(null, st.homeCategory)

  // 预填表单字段
  $('#event-name').value = form.name
  $('#start-date').value = form.startDate
  $('#start-time').value = form.startTime
  $('#end-date').value = form.endDate
  $('#end-time').value = form.endTime
  $('#event-location').value = form.location
  $('#event-note').value = form.note
  $('#admin-password').value = form.password
  $('#admin-password-confirm').value = form.passwordConfirm

  const previewCoverEl = $('#preview-cover')
  const coverGridEl = $('#cover-style-grid')
  const coverPreviewImg = $('#cover-preview-img')
  const existingSelect = $('#existing-event')
  const voiceSelect = $('#event-voice')

  // 三处列表都带签名缓存：输入名称会触发 update()，若无差别重建，
  // select 会丢选中项、焦点也会跳走；音色下拉有 72 项，只初始化一次。
  let lastExistingHtml = ''
  let lastCoverHtml = ''
  let voiceOptionsReady = false
  let previewScheduled = false

  function renderExisting() {
    const list = existingOptions()
    if (!list.length) {
      $('#select-event-section').style.display = 'none'
      return
    }
    $('#select-event-section').style.display = ''
    const html = '<option value="">请选择一本账簿</option>' +
      list.map((ev) => `<option value="${escapeHtml(ev.id)}">${escapeHtml(ev.name || '未命名账簿')}</option>`).join('')
    if (html !== lastExistingHtml) {
      existingSelect.innerHTML = html
      lastExistingHtml = html
    }
  }

  function renderCoverStyles() {
    const html = coverStyles()
      .map(
        (style) => `
        <button type="button" class="cover-style-item ${selectedStyle === style.id ? 'active' : ''}" data-style="${style.id}" title="${style.name}">
          <span class="cover-style-thumb">${coverFor(style.id)}</span>
          <span class="cover-style-name">${style.name}</span>
        </button>`,
      )
      .join('')
    if (html !== lastCoverHtml) {
      coverGridEl.innerHTML = html
      lastCoverHtml = html
    }
  }

  function renderVoiceOptions() {
    if (voiceOptionsReady) return
    voiceSelect.innerHTML =
      '<option value="">默认音色</option>' +
      voiceGroups
        .map(
          (group) =>
            `<optgroup label="${group.label}">` +
            group.options.map((o) => `<option value="${escapeHtml(o.value)}" ${form.voiceName === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('') +
            '</optgroup>',
        )
        .join('')
    voiceOptionsReady = true
  }

  // 封面预览按帧合并：同一帧内连打多个字只渲染一次，仍是「实时同步」。
  function schedulePreview() {
    if (previewScheduled) return
    previewScheduled = true
    requestAnimationFrame(() => {
      previewScheduled = false
      previewCoverEl.innerHTML = previewCover()
    })
  }

  function update() {
    const cp = copy()
    $('#setup-badge').textContent = isSolemn() ? '白 事' : '红 事'
    $('#setup-sub').textContent = cp.setupSub
    $('#setup-location-label').textContent = cp.locationLabel
    $('#event-name').placeholder = cp.namePh
    $('#event-location').placeholder = cp.locationPh
    $('#event-note').placeholder = cp.notePh
    $('#setup-pwd-hint').textContent = cp.pwdHint
    $('#voice-hint').textContent = voiceHintText
    schedulePreview()
    renderExisting()
    renderCoverStyles()
    renderVoiceOptions()
  }

  // 字段绑定
  $('#event-name').addEventListener('input', (e) => { form.name = e.target.value; update() })
  $('#start-date').addEventListener('input', (e) => { form.startDate = e.target.value })
  $('#start-time').addEventListener('input', (e) => { form.startTime = e.target.value })
  $('#end-date').addEventListener('input', (e) => { form.endDate = e.target.value })
  $('#end-time').addEventListener('input', (e) => { form.endTime = e.target.value })
  $('#event-location').addEventListener('input', (e) => { form.location = e.target.value; update() })
  $('#event-note').addEventListener('input', (e) => { form.note = e.target.value })
  $('#admin-password').addEventListener('input', (e) => { form.password = e.target.value })
  $('#admin-password-confirm').addEventListener('input', (e) => { form.passwordConfirm = e.target.value })
  voiceSelect.addEventListener('change', (e) => { form.voiceName = e.target.value })

  coverGridEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.cover-style-item')
    if (!btn) return
    selectedStyle = btn.dataset.style
    update()
    pulse(previewCoverEl)
  })

  $('#cover-image-upload').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) { coverPreview = ''; coverPreviewImg.classList.add('hidden'); return }
    if (file.size > MAX_COVER_IMAGE_SIZE) {
      showAlert('图片过大', `封面图不能超过 ${MAX_COVER_IMAGE_SIZE / 1024 / 1024}MB，请压缩后重试。`)
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      coverPreview = String(reader.result || '')
      coverPreviewImg.src = coverPreview
      coverPreviewImg.classList.remove('hidden')
    }
    reader.readAsDataURL(file)
  })

  $('#preview-create-voice-btn').addEventListener('click', () => {
    if (!previewVoice(form.voiceName, copy().voiceSample)) {
      showAlert('无法试听', '当前浏览器不支持语音播报。')
    }
  })

  $('#setup-back').addEventListener('click', showHome)
  $('#enter-existing').addEventListener('click', async () => {
    const id = existingSelect.value
    if (!id) { showAlert('提示', '请先选择一本账簿。'); return }
    await openEvent(id)
  })

  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    if (submitting) return
    const name = form.name.trim()
    const startDateTime = `${form.startDate}T${form.startTime}`
    const endDateTime = `${form.endDate}T${form.endTime}`
    if (!name || !startDateTime || !endDateTime) {
      showAlert('信息不完整', '请填写账簿名称与起止时间。')
      return
    }
    if (form.password && form.passwordConfirm !== form.password) {
      showAlert('密码不一致', '两次输入的密码不一致。')
      return
    }
    if (new Date(startDateTime) >= new Date(endDateTime)) {
      showAlert('时间有误', '开始时间必须早于结束时间。')
      return
    }
    submitting = true
    const btn = $('#setup-submit')
    try {
      await withBusy(btn, async () => {
        const payload = {
          name,
          startDateTime,
          endDateTime,
          passwordHash: form.password ? hashPassword(form.password) : NO_PASSWORD_HASH,
          ...(form.password ? { kdf: LedgerCrypto.newKdfParams() } : {}),
          theme: isSolemn() ? 'theme-solemn' : 'theme-festive',
          voiceName: form.voiceName,
          coverImage: coverPreview || null,
          template: templates().find((t) => t.key === templateKey())?.name || null,
          coverStyle: selectedStyle || null,
          location: form.location.trim(),
          note: form.note.trim(),
          totalAmount: 0,
        }
        const result = await api.createEvent(payload)
        st.currentEvent = result.data
        st.currentPassword = form.password || NO_PASSWORD_KEY
        await loadEvents()
        success('账簿已创建', { detail: `「${name}」可以开始登记了`, duration: 3600 })
        // 喜字只属于红事；白事、创建失败一律不触发，celebrate 内部还会再判一次减动效。
        if (!isSolemn()) celebrate('囍')
        startSession()
      }, { busyText: '正在创建…' })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NETWORK') {
        showAlert('无法连接', '网络不可用，账簿未创建，请检查连接后重试。')
      } else {
        showAlert('创建失败', error.message || '请稍后重试。')
      }
    } finally {
      submitting = false
    }
  })

  update()
  const unsub = subscribe(update)
  return {
    unmount() {
      unsub()
    },
  }
}
