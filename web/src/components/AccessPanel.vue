<template>
  <div class="access-body">
    <label class="access-switch-row" for="access-toggle">
      <span>
        <b>启用管理员密码<span class="gb-hint" :data-hint="helpText" role="note" :aria-label="helpText" tabindex="0">?</span></b>
      </span>
      <input type="checkbox" id="access-toggle" v-model="enableAdmin" :disabled="st.multiFamily" />
    </label>
    <div class="access-fields">
      <div v-if="initialEnabled" class="field">
        <label for="access-current" class="field-label">当前管理员密码</label>
        <input v-model="current" type="password" id="access-current" placeholder="关闭或修改密码时填写" autocomplete="current-password" />
      </div>
      <div class="field">
        <label for="access-new" class="field-label">{{ initialEnabled ? '新管理员密码（留空则不修改）' : '设置管理员密码' }} <span class="opt">至少 8 位</span></label>
        <input v-model="next" type="password" id="access-new" :placeholder="initialEnabled ? '留空保持当前密码' : '至少 8 位'" autocomplete="new-password" />
      </div>
      <div class="field">
        <label for="access-confirm" class="field-label">确认新密码</label>
        <input v-model="confirm" type="password" id="access-confirm" placeholder="再次输入" autocomplete="new-password" />
      </div>
      <div v-if="!initialEnabled && st.authSetupRequired" class="field">
        <label for="access-setup-token" class="field-label">设置口令 <span class="opt">部署时配置</span></label>
        <input v-model="setupToken" type="password" id="access-setup-token" placeholder="开启管理员密码需要此口令" autocomplete="new-password" />
      </div>
    </div>
    <div v-if="error" class="access-error" role="alert">{{ error }}</div>
    <div class="dialog-actions">
      <button type="button" class="modal-btn-ghost" @click="cancel">取消</button>
      <button type="button" class="modal-btn-primary" :disabled="busy" @click="save">保存</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { state as st } from '../store.js'
import { api } from '../lib/api.js'
import { closeModal, alert as showAlert } from '../lib/modal.js'

const props = defineProps({ enabled: { type: Boolean, default: false } })

const initialEnabled = props.enabled
// 角色说明收进「?」：开关下方不再压两行解释。
const helpText = computed(() => (st.multiFamily
  ? '多家庭模式下为必需项，不能关闭；可以在这里修改密码。管理员密码用于跨家庭管理与整站备份，与家庭访问码、单本账簿的管理密码相互独立。'
  : '开启后，管理员用它进入所有家庭、管理家庭与整站备份；普通家庭成员仍用各自的家庭访问码，不受影响。管理员密码与家庭访问码、单本账簿的管理密码相互独立，请记在安全的地方。'))
// 未设置时打开这个面板的唯一目的就是设置密码，默认直接勾选启用；
// 已设置时保持当前状态，管理员可以主动关闭（多家庭下禁止关闭）。
const enableAdmin = ref(true)
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
  if (st.multiFamily && !enableAdmin.value) return (error.value = '多家庭模式下不能关闭管理员密码')
  if (enableAdmin.value) {
    if (!initialEnabled && !next.value) return (error.value = '请设置管理员密码')
    if (!initialEnabled && st.authSetupRequired && !setupToken.value) return (error.value = '请输入设置口令')
    if (next.value && next.value.length < 8) return (error.value = '管理员密码至少 8 位')
    if (next.value !== confirm.value) return (error.value = '两次输入的管理员密码不一致')
    busy.value = true
    try {
      const payload = { enabled: true }
      if (next.value) payload.password = next.value
      if (initialEnabled && current.value) payload.currentPassword = current.value
      if (!initialEnabled && st.authSetupRequired) payload.setupToken = setupToken.value
      await api.updateAuth(payload)
      st.authEnabled = true
      closeModal()
      showAlert('已保存', next.value ? '管理员密码已保存，请记在安全的地方。' : '管理员密码设置已保存。')
    } catch (err) {
      error.value = err.message || '保存失败'
    } finally {
      busy.value = false
    }
    return
  }
  if (initialEnabled && !current.value) return (error.value = '请输入当前管理员密码')
  busy.value = true
  try {
    await api.updateAuth({ enabled: false, currentPassword: current.value })
    st.authEnabled = false
    closeModal()
    showAlert('已关闭', '管理员入口已关闭；家庭访问码与账簿密码不受影响。')
  } catch (err) {
    error.value = err.message || '保存失败'
  } finally {
    busy.value = false
  }
}
</script>
