<template>
  <div id="app-container">
    <div id="setup-screen">
      <div class="setup-head">
        <div class="back-link" @click="showHome">← 返回首页</div>
        <div class="setup-badge">{{ isSolemn ? '白 事' : '红 事' }}</div>
      </div>
      <h1 class="setup-title">创建新账簿</h1>
      <p class="setup-sub" id="setup-sub">{{ copy.setupSub }}</p>
      <div class="setup-divider"></div>

      <div v-if="existingOptions.length" id="select-event-section" class="setup-section">
        <div class="setup-section-title">从已有账簿继续</div>
        <div class="setup-select-row">
          <select v-model="selectedExisting" aria-label="选择已有账簿">
            <option value="">请选择一本账簿</option>
            <option v-for="ev in existingOptions" :key="ev.id" :value="ev.id">{{ ev.name }}</option>
          </select>
          <button class="setup-btn-primary" @click="enterExisting">进入</button>
        </div>
      </div>

      <div class="setup-body">
        <form class="setup-form" autocomplete="off" @submit.prevent="submit">
          <div class="form-section-title"><span>01</span>账簿信息</div>
          <div class="setup-field">
            <label class="setup-label" for="event-name">账簿名称 <span class="req">*</span></label>
            <input v-model="form.name" type="text" id="event-name" :placeholder="copy.namePh" required class="setup-input" />
          </div>

          <div class="setup-grid2">
            <div class="setup-field">
              <label class="setup-label" for="start-date">开始时间 <span class="req">*</span></label>
              <div class="setup-dt">
                <input v-model="form.startDate" type="date" id="start-date" required class="setup-input" aria-label="开始日期" />
                <input v-model="form.startTime" type="time" id="start-time" required class="setup-input" aria-label="开始时间" />
              </div>
            </div>
            <div class="setup-field">
              <label class="setup-label" for="end-date">结束时间 <span class="req">*</span></label>
              <div class="setup-dt">
                <input v-model="form.endDate" type="date" id="end-date" required class="setup-input" aria-label="结束日期" />
                <input v-model="form.endTime" type="time" id="end-time" required class="setup-input" aria-label="结束时间" />
              </div>
            </div>
          </div>

          <div class="setup-grid2">
            <div class="setup-field">
              <label class="setup-label" for="event-location" id="setup-location-label">{{ copy.locationLabel }}</label>
              <div class="field-shell">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" /><circle cx="12" cy="10.6" r="2.4" /></svg>
                <input v-model="form.location" type="text" id="event-location" :placeholder="copy.locationPh" class="setup-input" maxlength="200" />
              </div>
            </div>
            <div class="setup-field">
              <label class="setup-label" for="event-note">账簿备注</label>
              <div class="field-shell">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5.5h14M5 10h14M5 14.5h9M5 19h6" /></svg>
                <input v-model="form.note" type="text" id="event-note" :placeholder="copy.notePh" class="setup-input" maxlength="4000" />
              </div>
            </div>
          </div>

          <div class="form-section-title"><span>02</span>访问与安全</div>
          <div class="setup-grid2">
            <div class="setup-field">
              <label class="setup-label" for="admin-password">管理密码 <span class="opt">建议设置</span></label>
              <div class="field-shell">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.4v2.6" /></svg>
                <input v-model="form.password" type="password" id="admin-password" placeholder="留空则不设密码" class="setup-input" autocomplete="new-password" />
              </div>
            </div>
            <div class="setup-field">
              <label class="setup-label" for="admin-password-confirm">确认密码</label>
              <div class="field-shell">
                <svg class="field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7M12 14.4v2.6" /></svg>
                <input v-model="form.passwordConfirm" type="password" id="admin-password-confirm" placeholder="再次输入" class="setup-input" autocomplete="new-password" />
              </div>
            </div>
          </div>
          <p class="setup-hint" id="setup-pwd-hint">{{ copy.pwdHint }}</p>

          <details class="setup-more" ref="moreDetails">
            <summary class="setup-more-summary">
              <span>更多设置（封面 / 语音）</span>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" clip-rule="evenodd" /></svg>
            </summary>
            <div class="setup-more-body">
              <div class="setup-field">
                <label class="setup-label">封面样式</label>
                <div id="cover-style-grid" class="cover-style-grid">
                  <button
                    v-for="style in coverStyles"
                    :key="style.id"
                    type="button"
                    class="cover-style-item"
                    :class="{ active: selectedStyle === style.id }"
                    :aria-pressed="selectedStyle === style.id"
                    :title="style.name"
                    @click="selectedStyle = style.id"
                  >
                    <span class="cover-style-thumb" v-html="coverFor(style.id)"></span>
                    <span class="cover-style-name">{{ style.name }}</span>
                  </button>
                </div>
                <p class="setup-hint">点选一套封面，右侧实时预览；导出与打印使用同一套封面。</p>
              </div>
              <div class="setup-field">
                <label for="cover-image-upload" class="setup-label">上传封面图（可选）</label>
                <input type="file" id="cover-image-upload" accept="image/*" class="setup-file" @change="onCoverFile" />
                <img v-if="coverPreview" :src="coverPreview" alt="封面预览" class="cover-edit-preview" />
                <p class="setup-hint">不上传也行，导出时会自动生成封面。建议 595 × 842px、小于 2MB。</p>
              </div>
              <div class="setup-field">
                <label for="event-voice" class="setup-label">语音播报音色</label>
                <div class="setup-dt">
                  <select v-model="form.voiceName" id="event-voice">
                    <option value="">默认音色</option>
                    <optgroup v-for="group in voiceGroups" :key="group.label" :label="group.label">
                      <option v-for="option in group.options" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </optgroup>
                  </select>
                  <button type="button" id="preview-create-voice-btn" class="setup-btn-ghost" @click="preview">试听</button>
                </div>
                <p class="setup-hint" id="voice-hint">{{ voiceHintText }}</p>
              </div>
            </div>
          </details>

          <button type="submit" class="setup-submit" :disabled="submitting">{{ submitting ? '正在创建…' : '保存并开始记账' }}</button>
        </form>

        <aside class="setup-preview" aria-label="封面实时预览">
          <div class="preview-heading"><span>封面预览</span><small><i aria-hidden="true"></i>实时同步</small></div>
          <div class="preview-cover" id="preview-cover" v-html="previewCover"></div>
          <p class="preview-hint">封面实时渲染，打印时自动排版<br />无需图片，文字与主题同步更新</p>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, watch } from 'vue'
import { state as st, hashPassword, NO_PASSWORD_HASH, NO_PASSWORD_KEY, LedgerCrypto } from '../store.js'
import { copyOf, isSolemnEvent, templatesFor, COVER_STYLES, TEMPLATE_DEFAULT_STYLE } from '../lib/content.js'
import { renderCoverMarkup } from '../lib/cover.js'
import { api, ApiError } from '../lib/api.js'
import { showHome, loadEvents, startSession } from '../bootstrap.js'
import { openEvent } from '../lib/actions.js'
import { alert as showAlert } from '../lib/modal.js'
import { buildVoiceGroups, voiceHint, previewVoice } from '../lib/voice.js'
import { celebrate, solemnAck } from '../lib/feedback.js'

const MAX_COVER_IMAGE_SIZE = 2 * 1024 * 1024

const copy = computed(() => copyOf(null, st.homeCategory))
const isSolemn = computed(() => st.homeCategory === 'white')
const templates = computed(() => templatesFor(st.homeCategory))

const form = reactive({
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
})

const selectedTemplate = ref(st.setupTemplate || null)
const selectedStyle = ref('')
const coverPreview = ref('')
const submitting = ref(false)
const selectedExisting = ref('')
const moreDetails = ref(null)

const { groups: voiceGroups, usable } = buildVoiceGroups()
const voiceHintText = ref(voiceHint(usable))

const existingOptions = computed(() => {
  const wantSolemn = st.homeCategory === 'white'
  return Object.values(st.cachedEvents || {}).filter((ev) => isSolemnEvent(ev, st.homeCategory) === wantSolemn)
})

const coverStyles = computed(() =>
  COVER_STYLES.filter((item) => item.theme === (isSolemn.value ? 'white' : 'red')),
)

const templateKey = computed(() => {
  if (selectedTemplate.value) return selectedTemplate.value
  const match = templates.value.find((t) => t.name === form.name || t.key === form.name)
  return match ? match.key : templates.value[0].key
})

const previewCover = computed(() =>
  renderCoverMarkup(
    {
      name: form.name.trim() || '账簿名称',
      theme: isSolemn.value ? 'theme-solemn' : 'theme-festive',
      template: templateKey.value,
      coverStyle: selectedStyle.value || TEMPLATE_DEFAULT_STYLE[templateKey.value],
      startDateTime: form.startDate ? `${form.startDate}T${form.startTime || '00:00'}` : '',
      location: form.location.trim(),
    },
    false,
    st.homeCategory,
  ),
)

const coverFor = (styleId) =>
  renderCoverMarkup(
    {
      theme: isSolemn.value ? 'theme-solemn' : 'theme-festive',
      template: templateKey.value,
      coverStyle: styleId || selectedStyle.value || TEMPLATE_DEFAULT_STYLE[templateKey.value],
    },
    true,
    st.homeCategory,
  )

watch(templateKey, (key) => {
  if (!selectedStyle.value) selectedStyle.value = TEMPLATE_DEFAULT_STYLE[key] || ''
}, { immediate: true })

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
  const template = templates.value.find((t) => t.key === key)
  if (template) form.name = template.name
  selectedStyle.value = TEMPLATE_DEFAULT_STYLE[key] || ''
}

function onCoverFile(event) {
  const file = event.target.files?.[0]
  if (!file) {
    coverPreview.value = ''
    return
  }
  if (file.size > MAX_COVER_IMAGE_SIZE) {
    showAlert('图片过大', `封面图不能超过 ${MAX_COVER_IMAGE_SIZE / 1024 / 1024}MB，请压缩后重试。`)
    event.target.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    coverPreview.value = String(reader.result || '')
  }
  reader.readAsDataURL(file)
}

function preview() {
  if (!previewVoice(form.voiceName, copy.value.voiceSample)) {
    showAlert('无法试听', '当前浏览器不支持语音播报。')
  }
}

async function enterExisting() {
  if (!selectedExisting.value) {
    showAlert('提示', '请先选择一本账簿。')
    return
  }
  await openEvent(selectedExisting.value)
}

async function submit() {
  if (submitting.value) return
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
  submitting.value = true
  try {
    const payload = {
      name,
      startDateTime,
      endDateTime,
      passwordHash: form.password ? hashPassword(form.password) : NO_PASSWORD_HASH,
      ...(form.password ? { kdf: LedgerCrypto.newKdfParams() } : {}),
      theme: isSolemn.value ? 'theme-solemn' : 'theme-festive',
      voiceName: form.voiceName,
      coverImage: coverPreview.value || null,
      template: templates.value.find((t) => t.key === templateKey.value)?.name || null,
      coverStyle: selectedStyle.value || null,
      location: form.location.trim(),
      note: form.note.trim(),
      totalAmount: 0,
    }
    const result = await api.createEvent(payload)
    st.currentEvent = result.data
    st.currentPassword = form.password || NO_PASSWORD_KEY
    await loadEvents()
    // 喜字只属于红事；白事、创建失败一律不触发，celebrate 内部还会再判一次减动效。
    if (isSolemn.value) solemnAck()
    else celebrate('囍')
    startSession()
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NETWORK') {
      showAlert('无法连接', '网络不可用，账簿未创建，请检查连接后重试。')
    } else {
      showAlert('创建失败', error.message || '请稍后重试。')
    }
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  setDefaultTimes()
  initFromTemplate()
  loadEvents()
})
</script>
