<template>
  <div class="autobackup-body">
    <label class="access-switch-row" for="auto-toggle">
      <span><b>定时自动备份</b><small>按设定间隔把所有账簿打包，存到服务器配置目录的 config/backups/ 下。备份内容与账簿导出相同，只有密文。</small></span>
      <input type="checkbox" id="auto-toggle" v-model="enabled" />
    </label>

    <div class="field">
      <label class="field-label">备份频率</label>
      <div class="option-chips">
        <button
          v-for="option in INTERVALS"
          :key="option.value"
          type="button"
          class="option-chip"
          :class="{ active: interval === option.value }"
          @click="interval = option.value"
        >{{ option.label }}</button>
      </div>
    </div>

    <div class="field">
      <label class="field-label" for="auto-keep">保留份数 <span class="opt">最近 {{ keep }} 份，更早的自动清理</span></label>
      <input id="auto-keep" v-model.number="keep" type="number" min="1" max="200" step="1" inputmode="numeric" />
    </div>

    <div class="autobackup-actions">
      <button type="button" class="themed-button-secondary" :disabled="busy" @click="runNow">
        {{ busy ? '备份中…' : '立即备份全部账簿' }}
      </button>
      <button type="button" class="themed-button-secondary" @click="pickFile">上传备份文件</button>
      <input ref="fileInput" type="file" accept=".zip,application/zip" class="ocr-file-input" @change="onFilePicked" />
    </div>
    <p class="field-hint">备份只包含加密后的礼金内容；别人拿到文件也打不开，需要对应账簿的管理密码。</p>

    <div class="autobackup-status">
      <div><span>上次备份</span><b>{{ lastBackupAt || '尚未备份' }}</b></div>
      <div><span>存放位置</span><code>{{ dir }}</code></div>
    </div>

    <div v-if="files.length" class="autobackup-files">
      <div class="autobackup-files-head">已有备份</div>
      <ul>
        <li v-for="file in files" :key="file.name">
          <div class="autobackup-file-info">
            <span class="autobackup-file-name">{{ file.name }}</span>
            <span class="autobackup-file-meta">{{ sizeText(file.size) }} · {{ timeText(file.modTime) }}</span>
          </div>
          <div class="autobackup-file-actions">
            <button type="button" class="autobackup-mini" @click="askRestore(file)">还原</button>
            <a class="autobackup-mini" :href="`/api/autobackup/file/${encodeURIComponent(file.name)}`">下载</a>
            <button type="button" class="autobackup-mini is-danger" @click="askDelete(file)">删除</button>
          </div>
        </li>
      </ul>
    </div>
    <p v-else class="field-hint">还没有备份文件。开启定时备份或点「立即备份全部账簿」生成一份。</p>

    <div v-if="error" class="access-error" role="alert">{{ error }}</div>
    <div v-if="message" class="field-hint autobackup-ok">{{ message }}</div>

    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="closeModal">关闭</button>
      <button type="button" class="modal-btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api.js'
import { openModal, closeModal, alert as showAlert } from '../lib/modal.js'
import { notify } from '../lib/notify.js'
import { state as st } from '../store.js'
import { verifyLedgerPassword } from '../lib/actions.js'
import { escapeHtml } from '../lib/crypto.js'

const INTERVALS = [
  { value: 1, label: '每小时' },
  { value: 6, label: '每 6 小时' },
  { value: 12, label: '每 12 小时' },
  { value: 24, label: '每天' },
  { value: 168, label: '每周' },
]

const enabled = ref(false)
const interval = ref(24)
const keep = ref(14)
const lastBackupAt = ref('')
const dir = ref('')
const files = ref([])
const error = ref('')
const message = ref('')
const busy = ref(false)
const saving = ref(false)
const fileInput = ref(null)

const sizeText = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const timeText = (value) => (value ? new Date(value).toLocaleString('zh-CN') : '')

async function load() {
  try {
    const result = await api.autobackupGet()
    const data = result.data || {}
    enabled.value = Boolean(data.enabled)
    interval.value = Number(data.intervalHours) || 24
    keep.value = Number(data.keep) || 14
    lastBackupAt.value = data.lastBackupAt || ''
    dir.value = data.dir || ''
    files.value = Array.isArray(data.files) ? data.files : []
    error.value = data.lastError || ''
  } catch (err) {
    error.value = err.message || '读取备份设置失败'
  }
}

async function save() {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await api.autobackupSave({ enabled: enabled.value, intervalHours: interval.value, keep: keep.value })
    await load()
    message.value = '设置已保存'
  } catch (err) {
    error.value = err.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function runNow() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await api.autobackupRun()
    await load()
    message.value = '已生成一份备份，包含全部账簿'
  } catch (err) {
    error.value = err.message || '备份失败'
  } finally {
    busy.value = false
  }
}

function pickFile() {
  const input = fileInput.value
  if (!input) return
  try {
    if (typeof input.showPicker === 'function') input.showPicker()
    else input.click()
  } catch {
    input.click()
  }
}

async function onFilePicked(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  await restoreFromFile(file)
}

// 还原前必须二次确认：有访问密码要输密码，没有要求手输「还原」
function confirmRestore(label) {
  return new Promise((resolve) => {
    const needPassword = Boolean(st.authEnabled)
    const body = `
      <div class="restore-confirm">
        <p><strong>即将用「${escapeHtml(label)}」覆盖当前全部账簿。</strong></p>
        <p class="confirm-note">现有数据会先移入数据目录的 .trash，确认无误后可手动删除。</p>
        <p class="confirm-note is-warning">此操作无法在页面中撤销。</p>
        ${needPassword
          ? '<label class="field-label" for="restore-pwd">请输入访问密码以继续</label><input id="restore-pwd" type="password" autocomplete="current-password" placeholder="访问密码" />'
          : '<label class="field-label" for="restore-text">请输入「还原」两个字以继续</label><input id="restore-text" type="text" placeholder="还原" autocomplete="off" />'}
        <div class="access-error hidden" id="restore-error" role="alert"></div>
      </div>`
    {
      const fail = (msg) => {
        const el = document.getElementById('restore-error')
        if (el) { el.textContent = msg; el.classList.remove('hidden') }
      }
      openModal('确认还原', { type: 'html', html: body }, [
        { text: '取消', class: 'modal-btn-ghost', keepOpen: true, handler: () => { resolve(false); closeModal() } },
        {
          text: '确认还原',
          class: 'modal-btn-danger',
          keepOpen: true,
          handler: async () => {
            if (needPassword) {
              const pwd = document.getElementById('restore-pwd')?.value || ''
              if (!pwd) return fail('请输入访问密码')
              try {
                await api.login(pwd)
              } catch (err) {
                return fail(err.message || '访问密码不正确')
              }
            } else {
              const text = (document.getElementById('restore-text')?.value || '').trim()
              if (text !== '还原') return fail('请输入「还原」两个字')
            }
            resolve(true)
            closeModal()
          },
        },
      ])
    }
  })
}

async function askRestore(file) {
  if (!(await confirmRestore(file.name))) return
  busy.value = true
  error.value = ''
  try {
    const result = await api.autobackupRestore(file.name)
    message.value = `已还原 ${result.data?.events ?? 0} 本账簿、${result.data?.gifts ?? 0} 条礼金记录`
    // confirmRestore 复用了同一个弹窗单例，面板组件此时已被卸载；
    // 组件内的 message/error 用户看不到，必须走全局反馈。
    notify.success('还原完成', `已还原 ${result.data?.events ?? 0} 本账簿、${result.data?.gifts ?? 0} 条礼金记录`)
    const { loadEvents, showHome, endSession } = await import('../bootstrap.js')
    endSession()
    await loadEvents()
    showHome()
  } catch (err) {
    error.value = err.message || '还原失败'
    showAlert('还原失败', err.message || '还原失败，请稍后重试。')
  } finally {
    busy.value = false
  }
}

async function restoreFromFile(file) {
  if (!(await confirmRestore(file.name))) return
  busy.value = true
  error.value = ''
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/backup/restore', { method: 'POST', body: form, credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.success) throw new Error(data.message || '还原失败')
    message.value = `已还原 ${data.data?.events ?? 0} 本账簿、${data.data?.gifts ?? 0} 条礼金记录`
    notify.success('还原完成', `已还原 ${data.data?.events ?? 0} 本账簿、${data.data?.gifts ?? 0} 条礼金记录`)
    const { loadEvents, showHome, endSession } = await import('../bootstrap.js')
    endSession()
    await loadEvents()
    showHome()
  } catch (err) {
    error.value = err.message || '还原失败'
    showAlert('还原失败', err.message || '还原失败，请稍后重试。')
  } finally {
    busy.value = false
  }
}

async function askDelete(file) {
  const ok = await new Promise((resolve) => {
    openModal('删除备份', { type: 'html', html: `<p>确定删除备份「${escapeHtml(file.name)}」吗？</p><p class="confirm-note">删除后无法恢复，但其他备份不受影响。</p>` }, [
      { text: '取消', class: 'modal-btn-ghost', handler: () => resolve(false) },
      { text: '删除', class: 'modal-btn-danger', handler: () => resolve(true) },
    ])
  })
  if (!ok) return
  try {
    await api.autobackupDelete(file.name)
    await load()
    message.value = '备份已删除'
  } catch (err) {
    error.value = err.message || '删除失败'
  }
}

onMounted(load)
</script>
