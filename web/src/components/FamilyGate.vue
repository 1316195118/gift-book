<template>
  <div class="auth-gate family-gate">
    <div class="auth-card">
      <div class="auth-seal" aria-hidden="true">家</div>
      <h1>{{ adminFamilies.length ? '选择要进入的家庭' : '选择家庭' }}</h1>
      <p v-if="adminFamilies.length">管理员已登录。请选择要进入的家庭，不需要再输入家庭访问码。</p>
      <p v-else>输入家庭访问码，进入对应家庭的礼簿。不同家庭之间看不到彼此的账簿。</p>
      <button v-if="lastFamily && lastFamily.hasCode" type="button" class="family-last-hint" @click="focusCode">
        上次进入：{{ lastFamily.name }}（输入访问码）
      </button>
      <button v-else-if="lastOpen" type="button" class="family-last-hint" @click="enterOpen(lastOpen)">
        上次进入：{{ lastOpen.name }}
      </button>
      <form v-if="!adminFamilies.length" @submit.prevent="submit">
        <label class="sr-only" for="family-code">家庭访问码</label>
        <input ref="codeInput" v-model="code" type="password" id="family-code" placeholder="家庭访问码" autocomplete="off" required />
        <div v-if="error" class="auth-error" id="family-error" role="alert">{{ error }}</div>
        <button type="submit" id="family-submit" :disabled="busy">{{ busy ? '验证中…' : '进入家庭' }}</button>
      </form>
      <div v-if="candidates.length" class="family-open-list">
        <p class="family-open-title">这个访问码对应多个家庭，请选择</p>
        <button
          v-for="item in candidates"
          :key="item.id"
          type="button"
          class="family-default-btn"
          :disabled="busy"
          @click="enterCandidate(item)"
        >
          进入「{{ item.name }}」<small class="family-code-state">{{ item.hasCode ? '已设访问码' : '免访问码' }}</small>
        </button>
      </div>
      <div v-else-if="adminFamilies.length" class="family-open-list">
        <p class="family-open-title">管理员：可进入任意家庭</p>
        <button
          v-for="item in adminFamilies"
          :key="item.id"
          type="button"
          class="family-default-btn"
          :disabled="busy"
          @click="enterOpen(item)"
        >
          进入「{{ item.name }}」<small class="family-code-state">{{ item.hasCode ? '已设访问码' : '免访问码' }}</small>
        </button>
      </div>
      <div v-else-if="openFamilies.length" class="family-open-list">
        <p class="family-open-title">免访问码家庭</p>
        <button
          v-for="item in openFamilies"
          :key="item.id"
          type="button"
          class="family-default-btn"
          :disabled="busy"
          @click="enterOpen(item)"
        >
          进入「{{ item.name }}」
        </button>
      </div>
      <p class="auth-note">访问码由家庭创建者设置，与管理员密码、账簿管理密码都不同。站点管理员登录后，会在这里直接看到可进入的家庭。</p>
      <p v-if="st.multiFamily && !st.authEnabled" class="auth-note is-warning">检测到多个家庭，但还没有设置管理员密码。请先设置，否则家庭管理与整站备份无法使用。</p>
      <button v-if="st.authEnabled && !adminFamilies.length" type="button" class="family-admin-login" id="family-admin-login" @click="openAdminLogin">
        管理员登录
      </button>
      <button v-else-if="!st.authEnabled" type="button" class="family-admin-login" id="family-admin-setup" @click="openAdminSetup">
        首次使用？设置管理员密码
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../lib/api.js'
import { state as st } from '../store.js'

const openFamilies = ref([])
const adminFamilies = ref([])
const candidates = ref([])
const lastFamily = ref(null)
const code = ref('')
const codeInput = ref(null)
const error = ref('')
const busy = ref(false)
let optionsRequest = 0

const lastOpen = computed(() => {
  if (!lastFamily.value || lastFamily.value.hasCode) return null
  return openFamilies.value.find((item) => item.id === lastFamily.value.id) || null
})

function rememberFamily(family) {
  if (!family || !family.id) return
  try {
    localStorage.setItem('giftbook_last_family', JSON.stringify({
      id: family.id,
      name: family.name,
      hasCode: Boolean(family.hasCode),
    }))
  } catch {
    /* 隐私模式忽略 */
  }
}

function focusCode() {
  codeInput.value?.focus()
}

function openAdminLogin() {
  st.authGateMode = 'login'
  st.authGate = true
}

function openAdminSetup() {
  st.authGateMode = 'setup'
  st.authGate = true
}

async function submit() {
  if (!code.value || busy.value) return
  busy.value = true
  error.value = ''
  candidates.value = []
  try {
    const result = await api.familyLogin({ accessCode: code.value })
    rememberFamily(result.data)
    location.reload()
  } catch (err) {
    // 修复前可能留下两家同码：让用户选一次，别默认进第一家。
    if (err?.code === 'FAMILY_AMBIGUOUS') {
      candidates.value = Array.isArray(err.data) ? err.data : []
      return
    }
    error.value = err.message || '家庭访问码不正确'
  } finally {
    busy.value = false
  }
}

async function loadFamilyOptions() {
  const request = ++optionsRequest
  if (!st.authChecked) return
  // 只有开启管理员密码且当前管理员已登录时，家庭门才展示全部家庭并允许免码进入。
  // 未开启管理员密码时，本机虽然可以管理家庭，但进入设码家庭仍必须输入家庭访问码。
  if (st.authEnabled) {
    try {
      const all = await api.listFamilies()
      if (request !== optionsRequest) return
      adminFamilies.value = Array.isArray(all.data) ? all.data : []
      openFamilies.value = []
      candidates.value = []
      return
    } catch {
      if (request !== optionsRequest) return
      adminFamilies.value = []
    }
  }
  try {
    const result = await api.openFamilies()
    if (request !== optionsRequest) return
    openFamilies.value = Array.isArray(result.data) ? result.data : []
  } catch {
    if (request !== optionsRequest) return
    // 读取开放家庭失败时保底显示「我的家庭」按钮。
    openFamilies.value = []
  }
}

watch(
  () => [st.authChecked, st.authEnabled],
  () => { void loadFamilyOptions() },
  { immediate: true },
)

onMounted(async () => {
  try {
    const raw = localStorage.getItem('giftbook_last_family')
    lastFamily.value = raw ? JSON.parse(raw) : null
  } catch {
    lastFamily.value = null
  }
})

async function enterOpen(item) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  candidates.value = []
  try {
    const result = await api.familyLogin({ familyId: item.id })
    rememberFamily(result.data)
    location.reload()
  } catch (err) {
    // 管理员列表里也可能有需要访问码的家庭（例如单家庭、还没设管理员密码）：
    // 这时不要只报「码不正确」，把焦点送回输入框。
    if (err?.code === 'FAMILY_CODE') {
      error.value = `「${item.name}」需要访问码，请在下面输入后进入`
      focusCode()
    } else {
      error.value = err.message || '进入家庭失败'
    }
  } finally {
    busy.value = false
  }
}

// 重码时用「家庭 + 刚输入的访问码」一起登录，服务端按指定家庭校验。
async function enterCandidate(item) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await api.familyLogin({ familyId: item.id, accessCode: code.value })
    rememberFamily(result.data)
    location.reload()
  } catch (err) {
    error.value = err.message || '进入家庭失败'
  } finally {
    busy.value = false
  }
}
</script>
