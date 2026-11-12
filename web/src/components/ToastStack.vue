<template>
  <div id="gb-toast-stack" class="gb-toast-stack" role="status" aria-live="polite">
    <div
      v-for="item in items"
      :key="item.id"
      class="gb-toast"
      :class="['is-' + item.type, { 'is-paused': item.paused }]"
      @mouseenter="pause(item)"
      @mouseleave="resume(item)"
    >
      <span class="gb-toast-mark" aria-hidden="true">{{ marks[item.type] }}</span>
      <div class="gb-toast-body">
        <b class="gb-toast-title">{{ item.title }}</b>
        <p v-if="item.detail" class="gb-toast-detail">{{ item.detail }}</p>
      </div>
      <button type="button" class="gb-toast-close gb-no-ripple" aria-label="关闭提示" @click="dismiss(item.id)">×</button>
      <i class="gb-toast-progress" :style="{ animationDuration: item.duration + 'ms' }" aria-hidden="true"></i>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { notify } from '../lib/notify.js'
import { playSuccess, playError } from '../lib/sound.js'

const items = ref([])
const marks = { success: '✓', info: '·', warn: '!' }
const timers = new Map()
const left = new Map()
const since = new Map()

function dismiss(id) {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id); left.delete(id); since.delete(id)
  items.value = items.value.filter((it) => it.id !== id)
}

function arm(item) {
  left.set(item.id, item.duration)
  since.set(item.id, Date.now())
  timers.set(item.id, setTimeout(() => dismiss(item.id), item.duration))
}

function pause(item) {
  const timer = timers.get(item.id)
  if (!timer) return
  clearTimeout(timer)
  timers.delete(item.id)
  left.set(item.id, Math.max(0, left.get(item.id) - (Date.now() - since.get(item.id))))
  item.paused = true
}

function resume(item) {
  if (!item.paused) return
  item.paused = false
  since.set(item.id, Date.now())
  timers.set(item.id, setTimeout(() => dismiss(item.id), left.get(item.id)))
}

function onEvent(ev) {
  if (ev.type === 'dismiss') return dismiss(ev.id)
  if (ev.type !== 'push') return
  items.value.push(ev.item)
  while (items.value.length > 3) dismiss(items.value[0].id)
  arm(ev.item)
  if (ev.item.type === 'success') playSuccess()
  else if (ev.item.type === 'warn') playError()
}

let unsubscribe = null
onMounted(() => { unsubscribe = notify.subscribe(onEvent) })
onBeforeUnmount(() => {
  unsubscribe?.()
  timers.forEach((timer) => clearTimeout(timer))
})
</script>
