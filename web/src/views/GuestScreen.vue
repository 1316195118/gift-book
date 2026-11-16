<template>
  <div class="gb-guest-page">
    <div class="gb-guest-card">
      <div class="gb-guest-seal" aria-hidden="true">礼</div>
      <h1>{{ info?.name || '礼金登记' }}</h1>
      <p class="gb-guest-intro">{{ info ? '请填写礼金信息，主家确认后入簿。' : '正在读取登记信息…' }}</p>

      <form v-if="info" class="gb-guest-form" @submit.prevent="submit">
        <label class="field-label" for="guest-name">姓名</label>
        <input id="guest-name" v-model="name" type="text" maxlength="20" placeholder="您的姓名" autocomplete="name" required />

        <label class="field-label" for="guest-amount">礼金金额（元）</label>
        <input id="guest-amount" v-model.number="amount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="0.00" required />

        <label class="field-label" for="guest-relation">关系（选填）</label>
        <input id="guest-relation" v-model="relation" type="text" maxlength="20" placeholder="如：亲友 / 同事" autocomplete="off" />

        <label class="field-label" for="guest-note">留言（选填）</label>
        <input id="guest-note" v-model="note" type="text" maxlength="100" placeholder="给主家的话" autocomplete="off" />

        <div v-if="error" class="gb-inline-error" role="alert">{{ error }}</div>
        <button type="submit" class="modal-btn-primary" :disabled="busy">{{ busy ? '提交中…' : '提交登记' }}</button>
      </form>

      <div v-if="done" class="gb-guest-done" role="status">
        <b>登记成功</b>
        <p>主家确认后才会写入礼簿。您可以关闭这个页面。</p>
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
const name = ref('')
const amount = ref('')
const relation = ref('')
const note = ref('')
const busy = ref(false)
const error = ref('')
const done = ref(false)

onMounted(async () => {
  try {
    const result = await api.guestInfo(st.guestToken)
    info.value = result.data || {}
  } catch (err) {
    error.value = err.message || '登记入口不可用'
  }
})

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await api.guestSubmit(st.guestToken, {
      name: name.value.trim(),
      amount: Number(amount.value),
      relation: relation.value.trim(),
      note: note.value.trim(),
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
