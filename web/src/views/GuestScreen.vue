<template>
  <div class="gb-guest-page">
    <div class="gb-guest-card">
      <div class="gb-guest-seal" aria-hidden="true">礼</div>
      <h1>{{ info?.name || '礼金登记' }}</h1>
      <p class="gb-guest-intro">{{ info ? '请填写礼金信息，主家确认后入簿。' : (loading ? '正在读取登记信息…' : '暂时无法打开登记入口。') }}</p>

      <form v-if="info && !done" class="gb-guest-form" novalidate @submit.prevent="submit">
        <label class="field-label" for="guest-name">姓名</label>
        <input id="guest-name" v-model="name" type="text" maxlength="20" placeholder="您的姓名" autocomplete="name" required aria-describedby="guest-form-error" />

        <label class="field-label" for="guest-amount">礼金金额（元）</label>
        <input id="guest-amount" v-model.number="amount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="0.00" required aria-describedby="guest-form-error" />

        <label class="field-label" for="guest-relation">关系（选填）</label>
        <input id="guest-relation" v-model="relation" type="text" maxlength="20" placeholder="如：亲友 / 同事" autocomplete="off" />

        <label class="field-label" for="guest-note">留言（选填）</label>
        <input id="guest-note" v-model="note" type="text" maxlength="100" placeholder="给主家的话" autocomplete="off" />

        <div class="gb-honeypot" aria-hidden="true">
          <label for="guest-website">网站</label>
          <input id="guest-website" v-model="website" type="text" tabindex="-1" autocomplete="off" />
        </div>

        <div v-if="error" id="guest-form-error" class="gb-inline-error" role="alert">{{ error }}</div>
        <button type="submit" class="modal-btn-primary gb-guest-submit" :disabled="busy" :aria-busy="busy">
          {{ busy ? '正在提交…' : '提交登记' }}
        </button>
      </form>

      <div v-if="done" class="gb-guest-done" role="status">
        <span class="gb-guest-done-mark" aria-hidden="true">✓</span>
        <b>登记成功</b>
        <p>主家确认后才会写入礼簿。您可以关闭这个页面。</p>
      </div>

      <div v-if="error && !info" class="gb-inline-error" role="alert">
        {{ error }}
        <button type="button" class="gb-link-btn" @click="loadInfo">重新读取</button>
      </div>

      <p class="gb-picker-hint">登记内容在确认前以明文暂存在服务器，请只填写您愿意公开的信息。</p>
      <button type="button" class="gb-link-btn" @click="leave">返回首页</button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { state as st } from '../store.js'
import { api } from '../lib/api.js'

const info = ref(null)
const loading = ref(true)
const name = ref('')
const amount = ref('')
const relation = ref('')
const note = ref('')
const website = ref('')
const busy = ref(false)
const error = ref('')
const done = ref(false)

async function loadInfo() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.guestInfo(st.guestToken)
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
  const cleanRelation = relation.value.trim()
  const cleanNote = note.value.trim()
  const numericAmount = Number(amount.value)
  if (!cleanName) {
    error.value = '请先填写您的姓名。'
    return
  }
  if ([...cleanName].length > 20 || [...cleanRelation].length > 20 || [...cleanNote].length > 100) {
    error.value = '姓名最多 20 字，关系最多 20 字，留言最多 100 字。'
    return
  }
  if (!Number.isFinite(numericAmount) || numericAmount < 0.01 || numericAmount > 1000000) {
    error.value = '请输入 0.01 至 1,000,000 元之间的有效金额。'
    return
  }
  if (!navigator.onLine) {
    error.value = '网络似乎未连接，请恢复网络后重试。'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await api.guestSubmit(st.guestToken, {
      name: cleanName,
      amount: numericAmount,
      relation: cleanRelation,
      note: cleanNote,
      website: website.value,
    })
    done.value = true
  } catch (err) {
    error.value = err.message || '提交失败，请稍后再试'
  } finally {
    busy.value = false
  }
}

function leave() {
  window.history.replaceState({}, '', '/')
  st.guestToken = ''
  window.location.reload()
}
</script>
