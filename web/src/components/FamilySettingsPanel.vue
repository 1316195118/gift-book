<template>
  <div class="gb-family-settings">
    <p class="gb-picker-intro">这些设置只影响「{{ family.name }}」，不会改动其他家庭。修改访问码后，其他设备需要重新输入新码。</p>

    <div class="field">
      <label for="family-setting-name" class="field-label">家庭名称</label>
      <input id="family-setting-name" v-model="name" type="text" maxlength="40" autocomplete="off" />
    </div>

    <template v-if="family.hasCode">
      <div class="field">
        <label for="family-setting-current" class="field-label">当前访问码 <span class="opt">改码时必填</span></label>
        <input id="family-setting-current" v-model="currentCode" type="password" autocomplete="current-password" placeholder="输入当前家庭访问码" />
      </div>
    </template>

    <div class="field">
      <label for="family-setting-new" class="field-label">{{ family.hasCode ? '新访问码（留空则不修改）' : '设置访问码' }} <span class="opt">至少 8 位</span></label>
      <input
        id="family-setting-new"
        v-model="newCode"
        type="password"
        autocomplete="new-password"
        :placeholder="codeDisabled ? '开放家庭设置访问码需要管理员操作' : '至少 8 位'"
        :disabled="codeDisabled || removeCode"
      />
      <p v-if="newCodeHint.text" class="gb-picker-hint" :class="{ 'is-warning': newCodeHint.level === 'weak' }">{{ newCodeHint.text }}</p>
    </div>
    <div class="field" v-if="!removeCode">
      <label for="family-setting-confirm" class="field-label">确认新访问码</label>
      <input id="family-setting-confirm" v-model="confirmCode" type="password" autocomplete="new-password" :disabled="codeDisabled" />
    </div>

    <label v-if="family.hasCode" class="access-switch-row" for="family-setting-remove">
      <span><b>取消访问码，改为开放家庭</b><small>任何能打开本站的人都能进入这个家庭，请谨慎使用。</small></span>
      <input id="family-setting-remove" v-model="removeCode" type="checkbox" />
    </label>

    <div v-if="error" class="gb-inline-error" role="alert">{{ error }}</div>
    <p class="gb-picker-hint">访问码与账簿的管理密码相互独立；改码或取消访问码后，其他设备上的家庭会话会立即失效。</p>

    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="closeModal">取消</button>
      <button type="button" class="modal-btn-primary" :disabled="busy" @click="save">保存</button>
    </div>

    <div v-if="family.admin" class="gb-danger-zone">
      <b>退出该家庭的所有设备</b>
      <p>所有成员需要重新输入访问码；当前这台设备也会退出管理。</p>
      <button type="button" class="modal-btn-danger" :disabled="busy" @click="logoutAll">退出所有设备</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { state as st } from '../store.js'
import { api } from '../lib/api.js'
import { closeModal, confirm, alert as showAlert } from '../lib/modal.js'
import { familyCodeProblem, familyCodeHint } from '../lib/family-code.js'
import { notify } from '../lib/notify.js'

const family = computed(() => st.family || {})
const name = ref(st.family?.name || '')
const currentCode = ref('')
const newCode = ref('')
const confirmCode = ref('')
const removeCode = ref(false)
const busy = ref(false)
const error = ref('')

// 开放家庭没有可验证的旧码，普通成员不能直接给它上锁。
const codeDisabled = computed(() => !family.value.hasCode && !family.value.admin)
const newCodeHint = computed(() => (removeCode.value ? { level: '', text: '' } : familyCodeHint(newCode.value)))

async function save() {
  if (busy.value) return
  error.value = ''
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    error.value = '家庭名称不能为空'
    return
  }
  const payload = {}
  if (trimmedName !== family.value.name) payload.name = trimmedName

  const wantsCodeChange = removeCode.value || Boolean(newCode.value)
  if (wantsCodeChange) {
    if (codeDisabled.value) {
      error.value = '开放家庭设置访问码需要站点管理员操作'
      return
    }
    if (family.value.hasCode && !currentCode.value) {
      error.value = '请输入当前家庭访问码'
      return
    }
    if (removeCode.value) {
      payload.newCode = ''
    } else {
      const problem = familyCodeProblem(newCode.value)
      if (problem) {
        error.value = problem
        return
      }
      if (newCode.value !== confirmCode.value) {
        error.value = '两次输入的新访问码不一致'
        return
      }
      payload.newCode = newCode.value
    }
    if (family.value.hasCode) payload.currentCode = currentCode.value
  }

  if (!payload.name && payload.newCode === undefined) {
    error.value = '没有要修改的内容'
    return
  }
  busy.value = true
  try {
    await api.familySelfUpdate(payload)
    closeModal()
    notify.success('家庭设置已保存', payload.newCode === undefined ? '家庭名称已更新。' : '访问码已更新，其他设备需要重新验证。')
    setTimeout(() => location.reload(), 800)
  } catch (err) {
    error.value = err.message || '保存失败，请重试'
  } finally {
    busy.value = false
  }
}

function logoutAll() {
  confirm(
    '退出所有设备',
    `将让「${family.value.name}」的所有设备重新输入访问码，包括当前设备。确定吗？`,
    async () => {
      try {
        await api.logoutAllDevices(family.value.id)
        notify.success('已退出所有设备', '请重新选择家庭并输入访问码。')
        setTimeout(() => location.reload(), 700)
      } catch (err) {
        showAlert('操作失败', err.message || '请稍后重试。')
      }
    },
  )
}
</script>
