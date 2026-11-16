<template>
  <div class="gb-family-backup">
    <p class="gb-picker-intro">
      家庭备份只含「{{ familyName }}」的账簿与礼金密文，不包含其他家庭，也不包含管理员密码。
      换机或误删时，可以把它还原回本家庭。
    </p>
    <div class="gb-backup-actions">
      <button type="button" id="family-backup-download" class="modal-btn-primary" :disabled="busy" @click="download">
        下载家庭备份
      </button>
      <button type="button" id="family-backup-pick" class="modal-btn-ghost" :disabled="busy || !canRestore" @click="pickFile">
        还原家庭备份
      </button>
    </div>
    <input ref="fileInput" type="file" accept=".zip,application/zip" hidden @change="onFilePicked" />
    <p class="gb-picker-hint">还原会用备份覆盖本家庭的账簿，其他家庭不受影响；操作前会再确认一次。</p>
    <p v-if="!canRestore" class="gb-picker-hint is-warning">开放家庭没有访问码可以二次验证，还原需要管理员登录。</p>
    <p class="gb-picker-hint is-warning">备份文件里账簿名称、日期等是明文，只有礼金内容是密文；请存放在安全的位置。</p>
    <p class="gb-picker-hint">上次备份：{{ lastBackupText }}</p>

    <section class="gb-family-auto">
      <h4>服务器自动备份</h4>
      <p class="gb-picker-hint">{{ autoEnabled ? `按管理员的备份频率自动生成，保留最近 ${autoKeep} 份。` : autoOffText }}</p>
      <div v-if="autoFiles.length" class="gb-family-auto-list">
        <div v-for="file in autoFiles" :key="file.name" class="gb-family-auto-row">
          <div>
            <b>{{ file.name }}</b>
            <span>{{ file.modTime }} · {{ sizeText(file.size) }}</span>
          </div>
            <div class="gb-family-auto-actions">
              <button type="button" class="gb-link-btn" @click="downloadAuto(file)">下载</button>
              <button type="button" class="gb-link-btn" :disabled="!canRestore" @click="restoreAuto(file)">还原</button>
            </div>
        </div>
      </div>
      <p v-else-if="autoEnabled" class="gb-picker-hint">还没有自动备份；等下一次定时任务，或让管理员点「立即备份」。</p>
    </section>
    <div v-if="error" class="gb-inline-error" id="family-backup-error" role="alert">{{ error }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { state as st } from '../store.js'
import { api } from '../lib/api.js'
import { openModal, closeModal, alert as showAlert } from '../lib/modal.js'
import { notify } from '../lib/notify.js'
import { escapeHtml, safeFileName } from '../lib/crypto.js'

const familyName = computed(() => st.family?.name || '当前家庭')
const lastBackupText = computed(() => st.family?.lastBackupAt || '还没有备份过')
// 还原需要二次验证：有访问码就输码；开放家庭只能管理员来。
const canRestore = computed(() => Boolean(st.family?.admin || st.family?.hasCode))
const busy = ref(false)
const error = ref('')
const fileInput = ref(null)
const autoEnabled = ref(false)
const siteEnabled = ref(false)
const familyEnabled = ref(true)
const autoKeep = ref(7)
const autoFiles = ref([])

// 家庭备份挂在整站定时任务里：整站开关关掉时它们不会生成，提示要说清是哪一层没开。
const autoOffText = computed(() => {
  if (!siteEnabled.value) return '管理员没有开启「定时自动备份」，家庭自动备份也不会运行。'
  if (!familyEnabled.value) return '管理员没有开启「同时为每个家庭单独备份」。'
  return '管理员还没有开启「家庭自动备份」。'
})

const sizeText = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

async function loadAuto() {
  try {
    const result = await api.familyAutoBackups()
    const data = result.data || {}
    autoEnabled.value = Boolean(data.enabled)
    siteEnabled.value = data.siteEnabled !== false
    familyEnabled.value = data.familyEnabled !== false
    autoKeep.value = Number(data.keep) || 7
    autoFiles.value = Array.isArray(data.files) ? data.files : []
  } catch {
    autoEnabled.value = false
    autoFiles.value = []
  }
}

async function downloadAuto(file) {
  try {
    const res = await fetch(`/api/family/auto-backups/${encodeURIComponent(file.name)}`, { credentials: 'same-origin' })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      throw new Error(payload.message || '下载失败')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  } catch (err) {
    error.value = err.message || '下载失败，请重试'
  }
}

function restoreAuto(file) {
  confirmRestore(file, { server: true })
}

function pickFile() {
  if (busy.value) return
  error.value = ''
  fileInput.value?.click()
}

async function download() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await fetch('/api/family/backup', { credentials: 'same-origin' })
    if (!res.ok) {
      let message = '下载失败，请重试'
      try {
        const payload = await res.json()
        message = payload.message || message
      } catch {
        /* 非 JSON 响应 */
      }
      throw new Error(message)
    }
    const blob = await res.blob()
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const name = safeFileName(`${familyName.value}-家庭备份-${stamp}`) + '.zip'
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    if (st.family) st.family.lastBackupAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
    notify.success('家庭备份已下载', `${familyName.value}的账簿与礼金密文都在这个文件里。`)
  } catch (err) {
    error.value = err.message || '下载失败，请重试'
  } finally {
    busy.value = false
  }
}

function onFilePicked(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  confirmRestore(file)
}

function confirmRestore(file, options = {}) {
  const server = Boolean(options.server)
  const hasCode = Boolean(st.family?.hasCode)
  const isAdmin = Boolean(st.family?.admin)
  // 开放家庭没有访问码可以二次验证，服务端也会拒绝；提前说清楚，别让用户白选文件。
  if (!isAdmin && !hasCode) {
    showAlert('需要管理员登录', '开放家庭没有访问码可以作为二次验证，还原只能由管理员操作。')
    return
  }
  const html = `
    <div class="gb-family-restore">
      <p><strong>即将用「${escapeHtml(file.name)}」覆盖本家庭的账簿。</strong></p>
      ${server ? '<p class="confirm-note">这是服务器上的家庭自动备份；还原只影响当前家庭。</p>' : ''}
      <p class="confirm-note">「${escapeHtml(familyName.value)}」现有的账簿会被替换，其他家庭不受影响。</p>
      <p class="confirm-note is-warning">如果这份备份来自其他家庭，会被拒绝；还原前请确认文件来源。</p>
      <label class="field-label" for="family-restore-text">请输入「还原」两个字以继续</label>
      <input id="family-restore-text" type="text" placeholder="还原" autocomplete="off" />
      ${hasCode ? `
        <label class="field-label" for="family-restore-code">家庭访问码${isAdmin ? '（管理员可留空）' : '（还原前需重新验证）'}</label>
        <input id="family-restore-code" type="password" autocomplete="off" placeholder="${isAdmin ? '管理员可留空' : '重新输入家庭访问码'}" />` : ''}
      <div class="access-error hidden" id="family-restore-error" role="alert"></div>
    </div>`
  openModal('确认还原家庭备份', { type: 'html', html }, [
    { text: '取消', class: 'modal-btn-ghost' },
    {
      text: '确认还原',
      class: 'modal-btn-danger',
      keepOpen: true,
      handler: async () => {
        const typed = (document.getElementById('family-restore-text')?.value || '').trim()
        const code = String(document.getElementById('family-restore-code')?.value || '').trim()
        const fail = (message) => {
          const el = document.getElementById('family-restore-error')
          if (el) {
            el.textContent = message
            el.classList.remove('hidden')
          }
        }
        if (typed !== '还原') return fail('请输入「还原」两个字')
        if (hasCode && !isAdmin && !code) return fail('请重新输入家庭访问码')
        try {
          let events = 0
          if (server) {
            const result = await api.familyAutoBackupRestore(file.name, code)
            events = result.data?.events ?? 0
          } else {
            const form = new FormData()
            form.append('file', file, file.name)
            const res = await fetch('/api/family/backup/restore', {
              method: 'POST',
              body: form,
              credentials: 'same-origin',
              headers: code ? { 'X-Family-Code': code } : {},
            })
            const payload = await res.json().catch(() => ({}))
            if (!res.ok || !payload.success) throw new Error(payload.message || '还原失败，请重试')
            events = payload.data?.events ?? 0
          }
          closeModal()
          notify.success('家庭备份已还原', `已恢复 ${events} 本账簿，页面即将刷新。`)
          setTimeout(() => location.reload(), 900)
        } catch (err) {
          fail(err.message || '还原失败，请重试')
        }
      },
    },
  ], { dismissable: true })
}

onMounted(loadAuto)
</script>
