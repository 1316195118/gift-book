<template>
  <div class="gb-backup-health">
    <div class="gb-insight-hero" :class="`is-${health.level}`">
      <div>
        <span class="gb-insight-kicker">备份健康中心</span>
        <h3>{{ health.title }}</h3>
        <p>{{ loading ? '正在读取备份状态…' : health.latestAt ? `最近备份 ${formatDateTime(new Date(health.latestAt))}` : '当前没有可确认的备份文件。' }}</p>
      </div>
      <div class="gb-health-orb" :class="`is-${health.level}`"><b>{{ health.level === 'good' ? '稳' : health.level === 'warn' ? '!' : '险' }}</b><span>{{ health.checks.filter((item) => item.status === 'good').length }}/{{ health.checks.length }} 正常</span></div>
    </div>

    <div v-if="loading" class="gb-progress-card" role="status">
      <div class="gb-progress-head"><b>{{ loadingText }}</b><span class="gb-inline-spinner" aria-hidden="true"></span></div>
    </div>
    <div v-else class="gb-health-checks">
      <div v-for="check in health.checks" :key="check.key" class="gb-health-check" :class="`is-${check.status}`">
        <span aria-hidden="true">{{ check.status === 'good' ? '✓' : check.status === 'warn' ? '!' : '×' }}</span>
        <div><b>{{ check.title }}</b><small>{{ check.detail }}</small></div>
      </div>
    </div>

    <div v-if="!loading" class="gb-health-stats">
      <div><span>自动备份</span><b>{{ health.backupEnabled ? `每 ${health.intervalHours} 小时` : '未启用' }}</b></div>
      <div><span>整站文件</span><b>{{ health.autoFiles }} 份</b></div>
      <div><span>家庭文件</span><b>{{ health.familyFiles }} 份</b></div>
      <div><span>磁盘余量</span><b>{{ health.diskFree ? `${(health.diskFree / 1024 / 1024 / 1024).toFixed(1)} GB` : '未返回' }}</b></div>
    </div>

    <div class="gb-health-actions">
      <button v-if="isAdmin" type="button" class="modal-btn-primary" :disabled="busy" @click="runBackup">{{ busy ? '正在备份…' : '立即生成整站备份' }}</button>
      <button v-if="isAdmin" type="button" class="themed-button-secondary" @click="manageBackups">管理自动备份</button>
      <button type="button" class="themed-button-secondary" :disabled="busy" @click="pickVerify">检查现有备份包</button>
      <input ref="fileInput" type="file" accept=".zip,.gbenc,application/zip" hidden @change="verifyFile" />
    </div>
    <p class="gb-picker-hint">健康中心只判断现有备份时间、任务状态和文件数量；不会把“有文件”冒充成恢复演练成功。还原与备份包完整性检查请在对应面板继续操作。</p>
    <div v-if="message" class="field-hint autobackup-ok" role="status">{{ message }}</div>
    <div v-if="error" class="gb-inline-error" role="alert">{{ error }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { state as st } from '../store.js'
import { api } from '../lib/api.js'
import { assessBackupHealth } from '../lib/backup-health.js'
import { showBackupCheck } from '../lib/backup-check.js'
import { showAutoBackupModal } from '../lib/actions.js'
import { closeModal } from '../lib/modal.js'
import { formatDateTime } from '../lib/format.js'
import { notify } from '../lib/notify.js'

const isAdmin = computed(() => Boolean(st.family?.admin))
const loading = ref(true)
const loadingText = ref('正在读取备份概况…')
const busy = ref(false)
const error = ref('')
const message = ref('')
const auto = ref(null)
const familyInfo = ref(null)
const fileInput = ref(null)
const health = computed(() => assessBackupHealth({ auto: auto.value, family: st.family, familyInfo: familyInfo.value }))

async function load() {
  loading.value = true
  error.value = ''
  const tasks = [api.familyAutoBackups()]
  if (isAdmin.value) tasks.push(api.autobackupGet())
  loadingText.value = isAdmin.value ? '正在检查整站与家庭备份…' : '正在检查家庭备份…'
  const results = await Promise.allSettled(tasks)
  if (results[0]?.status === 'fulfilled') familyInfo.value = results[0].value.data || null
  if (results[1]?.status === 'fulfilled') auto.value = results[1].value.data || null
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) error.value = failure.reason?.message || '部分备份状态读取失败'
  loading.value = false
}

async function runBackup() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    await api.autobackupRun()
    message.value = '整站备份和家庭备份已生成，健康状态已刷新。'
    notify.success('备份已生成', '文件已原子写入备份目录。')
    await load()
  } catch (err) {
    error.value = err.message || '备份失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

function manageBackups() {
  closeModal()
  setTimeout(() => showAutoBackupModal(), 150)
}

function pickVerify() {
  fileInput.value?.click()
}

async function verifyFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  busy.value = true
  error.value = ''
  const endpoint = isAdmin.value ? '/api/backup/verify' : '/api/family/backup/verify'
  try {
    await showBackupCheck(endpoint, file)
  } catch (err) {
    error.value = err.message || '备份包检查失败'
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>
