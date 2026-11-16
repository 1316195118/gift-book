<template>
  <div class="auth-gate">
    <div class="auth-card">
      <div class="auth-seal" aria-hidden="true">礼</div>
      <h1>{{ isSetup ? '设置管理员密码' : '管理员登录' }}</h1>
      <p v-if="isSetup">设置后，管理员用这个密码进入所有家庭，并管理家庭与整站备份。普通家庭成员仍用各自的家庭访问码，不受影响。</p>
      <p v-else>请输入管理员密码。登录后可进入所有家庭，家庭访问码会自动放行。</p>
      <form @submit.prevent="submit">
        <label class="sr-only" for="auth-password">{{ isSetup ? '设置管理员密码' : '管理员密码' }}</label>
        <input
          v-model="password"
          type="password"
          id="auth-password"
          :placeholder="isSetup ? '管理员密码（至少 8 位）' : '管理员密码'"
          :autocomplete="isSetup ? 'new-password' : 'current-password'"
          required
        />
        <template v-if="isSetup">
          <label class="sr-only" for="auth-confirm">确认管理员密码</label>
          <input v-model="confirm" type="password" id="auth-confirm" placeholder="再次输入" autocomplete="new-password" required />
          <template v-if="st.authSetupRequired">
            <label class="sr-only" for="auth-setup-token">设置口令</label>
            <input v-model="setupToken" type="password" id="auth-setup-token" placeholder="设置口令（部署时配置）" autocomplete="new-password" required />
          </template>
        </template>
        <div v-if="error" class="auth-error" id="auth-error" role="alert">{{ error }}</div>
        <button type="submit" id="auth-submit" :disabled="busy">{{ busy ? '正在保存…' : (isSetup ? '保存并进入管理' : '进入礼簿') }}</button>
      </form>
      <p v-if="isSetup" class="auth-note">管理员密码与家庭访问码、单本账簿的管理密码互不相同。请记在安全的地方，忘记后只能在服务器上重置。</p>
      <p v-else class="auth-note">管理员密码由部署者设置；与家庭访问码、单本账簿的管理密码不同。登录状态保留 7 天。</p>
      <button type="button" class="family-default-btn" id="auth-cancel" @click="$emit('cancel')">
        {{ isSetup ? '取消' : '返回家庭门' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { api } from '../lib/api.js'
import { state as st } from '../store.js'

const props = defineProps({ mode: { type: String, default: 'login' } })
const emit = defineEmits(['submitted', 'cancel'])

const isSetup = computed(() => props.mode === 'setup')

const password = ref('')
const confirm = ref('')
const setupToken = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  if (!password.value || busy.value) return
  error.value = ''

  if (isSetup.value) {
    if (password.value.length < 8) {
      error.value = '管理员密码至少 8 位'
      return
    }
    if (password.value !== confirm.value) {
      error.value = '两次输入的管理员密码不一致'
      return
    }
    if (st.authSetupRequired && !setupToken.value) {
      error.value = '请输入设置口令'
      return
    }
    busy.value = true
    try {
      const payload = { enabled: true, password: password.value }
      if (st.authSetupRequired) payload.setupToken = setupToken.value
      await api.updateAuth(payload)
      st.authEnabled = true
      password.value = ''
      confirm.value = ''
      setupToken.value = ''
      emit('submitted')
    } catch (err) {
      error.value = err.message || '保存失败，请重试'
    } finally {
      busy.value = false
    }
    return
  }

  busy.value = true
  try {
    const result = await api.login(password.value)
    if (result.success && result.authenticated) {
      password.value = ''
      emit('submitted')
    } else {
      error.value = result.message || '管理员密码不正确'
    }
  } catch (err) {
    error.value = err.message || '管理员密码不正确'
  } finally {
    busy.value = false
  }
}
</script>
