<template>
  <div class="auth-gate">
    <div class="auth-card">
      <div class="auth-seal" aria-hidden="true">礼</div>
      <h1>访问验证</h1>
      <p>请输入访问密码，验证后进入礼簿。</p>
      <form @submit.prevent="submit">
        <label class="sr-only" for="auth-password">访问密码</label>
        <input v-model="password" type="password" id="auth-password" placeholder="访问密码" autocomplete="current-password" required />
        <div v-if="error" class="auth-error" id="auth-error" role="alert">{{ error }}</div>
        <button type="submit" id="auth-submit" :disabled="busy">{{ busy ? '验证中…' : '进入礼簿' }}</button>
      </form>
      <p class="auth-note">访问密码由部署者设置，与单本账簿的管理密码不同。登录状态保留 7 天。</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api } from '../lib/api.js'

const emit = defineEmits(['submitted'])

const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  if (!password.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await api.login(password.value)
    if (result.success && result.authenticated) {
      password.value = ''
      emit('submitted')
    } else {
      error.value = result.message || '访问密码不正确'
    }
  } catch (err) {
    error.value = err.message || '访问密码不正确'
  } finally {
    busy.value = false
  }
}
</script>
