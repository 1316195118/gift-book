<template>
  <div class="access-body">
    <label class="access-switch-row" for="access-toggle">
      <span><b>进入礼簿需要访问密码</b><small>关闭后本机直接进入；开启后每次打开需验证，登录状态保留 7 天。</small></span>
      <input type="checkbox" id="access-toggle" v-model="enabled" />
    </label>
    <div class="access-fields">
      <div v-if="initialEnabled" class="field">
        <label for="access-current" class="field-label">当前密码</label>
        <input v-model="current" type="password" id="access-current" placeholder="关闭或修改密码时填写" autocomplete="current-password" />
      </div>
      <div class="field">
        <label for="access-new" class="field-label">{{ initialEnabled ? '新密码（留空则不修改）' : '设置访问密码' }} <span class="opt">至少 8 位</span></label>
        <input v-model="next" type="password" id="access-new" :placeholder="initialEnabled ? '留空保持当前密码' : '至少 8 位'" autocomplete="new-password" />
      </div>
      <div class="field">
        <label for="access-confirm" class="field-label">确认新密码</label>
        <input v-model="confirm" type="password" id="access-confirm" placeholder="再次输入" autocomplete="new-password" />
      </div>
      <div v-if="!initialEnabled && st.authSetupRequired" class="field">
        <label for="access-setup-token" class="field-label">设置口令 <span class="opt">部署时配置</span></label>
        <input v-model="setupToken" type="password" id="access-setup-token" placeholder="开启访问保护需要此口令" autocomplete="new-password" />
      </div>
    </div>
    <div v-if="error" class="access-error" role="alert">{{ error }}</div>
    <p class="access-tip">访问保护与单本账簿的管理密码相互独立。开启后请把密码记在安全的地方。</p>
    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="cancel">取消</button>
      <button type="button" class="modal-btn-primary" :disabled="busy" @click="save">保存</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { state as st } from '../store.js'
import { api } from '../lib/api.js'
import { closeModal, alert as showAlert } from '../lib/modal.js'

const props = defineProps({ enabled: { type: Boolean, default: false } })

const initialEnabled = props.enabled
const enabled = ref(props.enabled)
const current = ref('')
const next = ref('')
const confirm = ref('')
const setupToken = ref('')
const error = ref('')
const busy = ref(false)

function cancel() {
  closeModal()
}

async function save() {
  error.value = ''
  if (busy.value) return
  if (enabled.value) {
    if (!initialEnabled && !next.value) return (error.value = '请设置访问密码')
    if (!initialEnabled && st.authSetupRequired && !setupToken.value) return (error.value = '请输入设置口令')
    if (next.value && next.value.length < 8) return (error.value = '访问密码至少 8 位')
    if (next.value !== confirm.value) return (error.value = '两次输入的密码不一致')
    busy.value = true
    try {
      const payload = { enabled: true }
      if (next.value) payload.password = next.value
      if (initialEnabled && current.value) payload.currentPassword = current.value
      if (!initialEnabled && st.authSetupRequired) payload.setupToken = setupToken.value
      await api.updateAuth(payload)
      st.authEnabled = true
      closeModal()
      showAlert('已开启', next.value ? '访问密码已保存。' : '设置已保存。')
    } catch (err) {
      error.value = err.message || '保存失败'
    } finally {
      busy.value = false
    }
    return
  }
  if (initialEnabled && !current.value) return (error.value = '请输入当前访问密码')
  busy.value = true
  try {
    await api.updateAuth({ enabled: false, currentPassword: current.value })
    st.authEnabled = false
    closeModal()
    showAlert('已关闭', '本机将直接进入礼簿。')
  } catch (err) {
    error.value = err.message || '保存失败'
  } finally {
    busy.value = false
  }
}
</script>
