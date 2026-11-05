<template>
  <div id="offline-toast" class="offline-toast" :class="{ hidden: !visible }" role="alert" aria-live="assertive">
    <button type="button" class="offline-toast-close" title="关闭提示" aria-label="关闭提示" @click="hide">×</button>
    <div class="offline-toast-head"><span class="offline-toast-dot" aria-hidden="true"></span><b>网络中断 · 已暂存</b></div>
    <p class="offline-toast-text" v-html="text"></p>
    <ul class="offline-toast-links">
      <li v-for="link in links" :key="link.label" :class="link.ok ? 'ok' : 'bad'">{{ link.label }} · {{ link.ok ? link.ms + ' ms' : '断开' }}</li>
    </ul>
    <div class="offline-toast-foot">
      <button type="button" class="offline-toast-retry" :disabled="busy" @click="retry">{{ busy ? '重试中…' : '立即重试' }}</button>
      <button type="button" class="offline-toast-ok" @click="hide">知道了</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { toast } from '../lib/toast.js'
import { refreshNetwork } from '../lib/network.js'

const visible = ref(false)
const text = ref('')
const links = ref([])
const busy = ref(false)
let timer = null

function show(payload) {
  text.value = payload.text || ''
  links.value = payload.links || []
  visible.value = true
  clearTimeout(timer)
  timer = setTimeout(hide, 15000)
}

function hide() {
  visible.value = false
  clearTimeout(timer)
}

async function retry() {
  busy.value = true
  try {
    await refreshNetwork()
    await toast.onRetry?.()
    hide()
  } finally {
    busy.value = false
  }
}

let off = null
onMounted(() => {
  off = toast.subscribe(show)
})
onBeforeUnmount(() => off && off())
</script>
