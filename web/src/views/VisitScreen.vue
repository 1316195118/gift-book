<template>
  <div class="gb-guest-page gb-visit-page">
    <div class="gb-guest-card">
      <div class="gb-guest-seal" aria-hidden="true">到</div>
      <h1>{{ info?.name || '来访登记' }}</h1>
      <p class="gb-guest-intro">{{ info ? '请填写来访信息，登记后即可入内。' : (loading ? '正在读取登记信息…' : '暂时无法打开登记入口。') }}</p>
      <p v-if="info && expiresText" class="gb-guest-validity">{{ expiresText }}</p>

      <form v-if="info && !done" class="gb-guest-form" novalidate @submit.prevent="submit">
        <label class="field-label" for="visit-name">来访人（户主）</label>
        <input id="visit-name" v-model="name" type="text" maxlength="20" placeholder="请填写您的姓名" autocomplete="name" required aria-describedby="visit-form-error" />

        <label class="field-label" for="visit-count">来访人数</label>
        <input id="visit-count" v-model.number="count" type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="1" required aria-describedby="visit-form-error" />
        <p class="gb-visit-hint">含您本人；例如一家三口请填 3。</p>

        <label class="field-label" for="visit-note">备注（选填）</label>
        <input id="visit-note" v-model="note" type="text" maxlength="100" placeholder="如：从外地来 / 亲友" autocomplete="off" />

        <div class="gb-honeypot" aria-hidden="true">
          <label for="visit-website">网站</label>
          <input id="visit-website" v-model="website" type="text" tabindex="-1" autocomplete="off" />
        </div>

        <div v-if="error" id="visit-form-error" class="gb-inline-error" role="alert">{{ error }}</div>
        <button type="submit" class="modal-btn-primary gb-guest-submit" :disabled="busy" :aria-busy="busy">
          {{ busy ? '正在登记…' : '提交登记' }}
        </button>
      </form>

      <div v-if="done" class="gb-guest-done" role="status">
        <span class="gb-guest-done-mark" aria-hidden="true">✓</span>
        <b>登记成功</b>
        <p>谢谢，您可以关闭这个页面。</p>
      </div>

      <div v-if="error && !info" class="gb-inline-error" role="alert">
        {{ error }}
        <button type="button" class="gb-link-btn" @click="loadInfo">重新读取</button>
      </div>

      <p class="gb-picker-hint">仅登记姓名、人数与备注，不收集金额。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { state as st } from '../store.js'
import { api } from '../lib/api.js'

const info = ref(null)
const loading = ref(true)
const busy = ref(false)
const done = ref(false)
const error = ref('')
const name = ref('')
const count = ref(1)
const note = ref('')
const website = ref('')

const expiresText = computed(() => {
  if (!info.value?.expiresAt) return ''
  const at = new Date(info.value.expiresAt)
  if (!Number.isFinite(at.getTime())) return ''
  return `登记入口有效至 ${at.toLocaleString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })}`
})

async function loadInfo() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.visitInfo(st.visitToken)
    info.value = result.data || {}
  } catch (err) {
    error.value = err.message || '登记入口不可用'
  } finally {
    loading.value = false
  }
}

onMounted(loadInfo)

async function submit() {
  if (busy.value) return
  const cleanName = name.value.trim()
  const cleanNote = note.value.trim()
  const n = Number(count.value)
  if (!cleanName) {
    error.value = '请填写来访人姓名。'
    return
  }
  if ([...cleanName].length > 20 || [...cleanNote].length > 100) {
    error.value = '姓名最多 20 字，备注最多 100 字。'
    return
  }
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    error.value = '人数请填写 1 至 100 之间的整数。'
    return
  }
  if (!navigator.onLine) {
    error.value = '网络似乎未连接，请恢复网络后重试。'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await api.visitSubmit(st.visitToken, { name: cleanName, count: n, note: cleanNote, website: website.value })
    done.value = true
  } catch (err) {
    error.value = err.message || '登记失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>
